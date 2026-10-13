# Cover detection and resolution

This document is the canonical description of how myLibrary identifies an edition and obtains a cover. ISBN identification and image resolution are separate stages: an ISBN candidate can be correct even when no image provider has a cover, and a metadata cover can be shown without assigning an ISBN.

## 1. ISBN identification

Stage 2 builds and ranks ISBN candidates from these sources:

1. **Visible ISBN from Stage 1.** A complete ISBN visibly read from the physical book is validated, converted to canonical ISBN-13, and treated as the strongest automatic evidence.
2. **Reviewed myLibrary catalogue.** The local `legacy-catalogue` provider exposes previously reviewed ISBN mappings without a network request or quota. This preserves known mappings across collection deletion and re-import.
3. **Open Library Search API.** Searches by title, author, and, when present, series; ISBNs are extracted from matching records.
4. **Google Books Volumes API.** Searches by title, author, and series and extracts ISBN-10/ISBN-13 identifiers. `GOOGLE_BOOKS_API_KEY` is optional but recommended because anonymous shared traffic is frequently rate-limited.

Candidates are grouped by canonical ISBN-13, retained up to a maximum of ten, and scored using:

- title similarity: up to 500 points;
- author similarity: up to 250 points;
- series evidence: up to 150 points;
- publisher similarity: up to 100 points;
- matching publication year: 75 points;
- matching language: 25 points;
- agreement by more than one provider: 100 points.

The highest-ranked candidate is selected automatically as `algorithm_selected` only when it scores at least 500 points and leads the next edition by at least 50 points. A close edition race remains unresolved for owner review even when the work match is strong. Alternatives remain available to the owner. A provider failure does not count as a negative result: when no accepted candidate is found and at least one provider timed out, returned HTTP 429, or returned a 5xx response, the observation remains `ready_for_matching` and the import becomes `partial` for retry with exponential backoff.

Candidates separately store `work_confidence`, `edition_confidence`, and `cover_confidence`. Provider identifiers are structured data rather than a flattened label, so an Open Library cover ID/edition OLID or Google volume ID can be reused by later resolvers.

## 2. Cover resolution with an ISBN

Each selected image has a stable `cover_assets.id`, provenance, evidence, confidence, verification status, and storage policy. `copy_cover_selections` records whether it represents the exact edition or only the work and whether automation or the owner selected it. Public copies use `/api/cover-assets/{id}`; the asset points to the appropriate controlled resolver. The ISBN resolver `/api/covers/{isbn}` remains the lookup route behind ISBN assets and tries these sources in order:

1. **Bundled legacy cover.** If the selected ISBN has a reviewed local image in `books.json`/`isbn.json`, the route redirects to that asset. This is quota-free and is preferred over network providers.
2. **Open Library Covers API.** Requests the large image with `default=false` and validates that the response is a non-empty image no larger than 8 MB.
3. **Google Books by ISBN.** Queries `isbn:{isbn}` and chooses the largest available `imageLinks` value in this order: `extraLarge`, `large`, `medium`, `thumbnail`, then `smallThumbnail`. Only approved Google Books image hosts are accepted.
4. **Placeholder.** Returned only after every available provider gives a genuine negative result.

Successful responses use long-lived shared caching. Genuine misses use a short cache. HTTP 429, timeouts, and 5xx errors return HTTP 503 with `Retry-After` and are recorded as retryable `failed` cover jobs with `next_retry_at`; they are not marked permanently `missing`.

The `cover_resolution_jobs` lifecycle is:

`pending → processing → completed | missing | failed`

- `completed`: a real image was retrieved;
- `missing`: providers responded normally but no image exists;
- `failed`: a temporary provider or network failure occurred and the job can be retried with exponential backoff.

When the highest-ranked ISBN candidate is a strong work match (`work_confidence >= 0.85`) but does not pass the stricter exact-edition acceptance rule, the pipeline probes that candidate's ISBN cover endpoint. A real image from the reviewed catalogue, Open Library, or Google Books is selected as a **representative cover** without assigning the candidate ISBN to the copy. Placeholders, empty responses, and unlabelled images are rejected. This deliberately gives cover discovery more recall than edition assignment while keeping the two decisions independent.

## 3. Cover resolution without an ISBN

When no ISBN can be selected, the metadata resolver searches for a cover without creating an edition mapping:

1. **Reviewed local catalogue.** Previously reviewed bundled covers are matched by title and supporting author or publisher metadata even when the catalogue record has no ISBN. When Stage 1 transcribes a bad title, a cover may also be recovered from one exact, useful author only if that author has exactly one reviewed covered book in the local catalogue. This remains a representative cover and never assigns the reviewed ISBN or overwrites the imported title. This source is quota-free.
2. **Open Library title search.** Candidate images come from `cover_i` and include title, author, and publisher metadata.
3. **Google Books title search.** Candidate images come from the largest available `imageLinks` entry and include title, author, and publisher metadata.

Metadata-cover candidates are scored using:

- title similarity: up to 700 points;
- publisher similarity: up to 180 points;
- author similarity: up to 120 points.

A candidate is accepted only when it has one of these evidence combinations:

- an exact normalized, distinctive title containing at least four tokens;
- an exact normalized title corroborated by author or publisher;
- a near-exact title corroborated by author or publisher.

This conservative gate prevents ambiguous titles from receiving unrelated covers. Accepted candidates are stored in `metadata_cover_candidates`; only the highest-ranked candidate is selected. The application serves it through `/api/covers/metadata/{copyId}`, which validates the source host, response type, and 8 MB size limit before applying shared caching. Metadata resolution never invents or assigns an ISBN.

Metadata-provider requests retry transient responses internally. Unlike the ISBN and ISBN-cover queues, the metadata-only fallback does not yet persist its own retry job after those attempts are exhausted; it will run again when the containing import is retried or during a later metadata-cover batch.

## 4. Owner corrections

On an owned collection page, the owner can:

- select any retained edition candidate, changing both ISBN and cover;
- enter an ISBN manually, which is validated and canonicalized before use.

Owner decisions retain separate provenance and are not silently overwritten by subsequent automatic matching.

Rejecting an edition records durable feedback, removes an automatic selection when necessary, and prevents the same ISBN from being proposed again for that physical copy.

## Provider safety and operations

- Only canonical, checksum-valid ISBNs reach ISBN cover resolution.
- Third-party image URLs are proxied or redirected through controlled application routes.
- Provider hosts are allowlisted and response content types and sizes are validated.
- ISBN and ISBN-cover provider outages remain distinct from genuine `not found` results.
- Covers and negative results are cached to control latency and provider usage.
- The original shelf photograph is not required or retained by cover resolution.

See [ISBN_MAPPING.md](ISBN_MAPPING.md) for the provider roadmap and edition-review rules, and [INGESTION_PIPELINE.md](INGESTION_PIPELINE.md) for the full Stage 1–4 choreography.
Credential-dependent and web-page providers are tracked in [PROVIDER_INTEGRATIONS.md](PROVIDER_INTEGRATIONS.md).
