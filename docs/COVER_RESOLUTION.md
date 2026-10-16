# Cover detection and resolution

Supabase is the only catalogue and lookup-state store; no local catalogue files are used. External providers enrich unresolved database records.

This document is the canonical description of how myLibrary identifies an edition and obtains a cover. ISBN identification and image resolution are separate stages: an ISBN candidate can be correct even when no image provider has a cover, and a metadata cover can be shown without assigning an ISBN.

## 1. ISBN identification

Stage 2 builds and ranks ISBN candidates from these sources:

1. **Assistant-verified ISBN from Stage 1.** A complete ISBN read from the photo or verified on a matching edition page is checksum-validated and converted to canonical ISBN-13. Visible and researched provenance remain distinct.
2. **Open Library Search API.** Searches by title, author, and, when present, series; ISBNs are extracted from matching records.
3. **Google Books Volumes API.** Searches by title, author, and series and extracts ISBN-10/ISBN-13 identifiers. `GOOGLE_BOOKS_API_KEY` is optional but recommended because anonymous shared traffic is frequently rate-limited.

Candidates are grouped by canonical ISBN-13, retained up to a maximum of ten, and scored using:

- title similarity: up to 500 points;
- author similarity: up to 250 points;
- series evidence: up to 150 points;
- publisher similarity: up to 100 points;
- matching publication year: 75 points;
- matching language: 25 points;
- agreement by more than one provider: 100 points.

The highest-ranked candidate is selected automatically as `algorithm_selected` only when it scores at least 500 points and leads the next edition by at least 50 points. A close edition race remains unresolved for owner review even when the work match is strong. Alternatives remain available to the owner. When no accepted candidate is found, the observation becomes unresolved after the current provider attempt; there is no scheduled or owner-operated retry queue.

Stage 2 candidates store `work_confidence` and `edition_confidence`; Stage 3 supplies `cover_confidence`. Provider identifiers are structured data rather than a flattened label, so an Open Library edition OLID or Google volume ID can be reused by later resolvers.

All backend cover detection runs in Stage 3, after Stage 2 has finished ISBN identification. Stage 2 stores bibliographic evidence and queues selected ISBNs; it does not assign cover URLs or assets. Stage 3 resolves selected ISBNs, then representative candidates, then metadata fallbacks.

## 2. Cover resolution with an ISBN

When Stage 1 supplies `coverUrl`, ingestion uses that public HTTPS image immediately and records `assistant-supplied` provenance. If an ISBN is also present, the edition is attached and its cover job is marked completed. The remaining provider cascade is a fallback only when `coverUrl` is absent.

Each selected image has a stable `cover_assets.id`, provenance, evidence, confidence, verification status, and storage policy. `copy_cover_selections` records whether it represents the exact edition or only the work and whether automation or the owner selected it. Public copies use `/api/cover-assets/{id}`; the asset points to the appropriate controlled resolver. The ISBN resolver `/api/covers/{isbn}` remains the lookup route behind ISBN assets and tries these sources in order:

1. **Open Library Covers API.** Requests the large image with `default=false` and validates that the response is a non-empty image no larger than 8 MB.
2. **Google Books by ISBN.** Queries `isbn:{isbn}` and chooses the largest available `imageLinks` value in this order: `extraLarge`, `large`, `medium`, `thumbnail`, then `smallThumbnail`. Only approved Google Books image hosts are accepted.
3. **Placeholder.** Returned only after every available provider gives a genuine negative result.

Successful responses use long-lived shared caching. Genuine misses use a short cache. HTTP 429, timeouts, and 5xx errors return HTTP 503 and are recorded as terminal `failed` cover jobs for operational visibility.

The `cover_resolution_jobs` lifecycle is:

`pending → processing → completed | missing | failed`

- `completed`: a real image was retrieved;
- `missing`: providers responded normally but no image exists;
- `failed`: a provider or network failure prevented resolution during the event-driven attempt.

When the highest-ranked ISBN candidate is a strong work match (`work_confidence >= 0.85`) but does not pass the stricter exact-edition acceptance rule, the pipeline probes that candidate's ISBN cover endpoint. A real image from Open Library or Google Books is selected as a **representative cover** without assigning the candidate ISBN to the copy. Placeholders, empty responses, and unlabelled images are rejected. This deliberately gives cover discovery more recall than edition assignment while keeping the two decisions independent.

## 3. Cover resolution without an ISBN

When no ISBN can be selected, the metadata resolver searches for a cover without creating an edition mapping:

1. **Open Library title and contributor search.** Candidate images come from `cover_i` and include title, subtitle, author, and publisher metadata. If Stage 1 found two or more useful contributors, a second query uses that contributor signature. This can recover translated titles (for example, a Greek title catalogued only under English) only when at least two contributors and a translated, non-series subtitle anchor agree. Generic series words are excluded so one volume's cover is not reused across a series. Such a match is explicitly a representative cover: it does not assign the other-language edition's ISBN.
2. **Google Books title search.** Candidate images come from the largest available `imageLinks` entry and include title, author, and publisher metadata.
3. **Verified web-page discovery.** When catalogue APIs fail, DuckDuckGo HTML and Bing RSS web results are queried with progressively broader exact and relaxed title, author, publisher, and Greek `εξώφυλλο` searches. Result pages are fetched only over public HTTPS, with private-address blocking, redirect validation, timeouts, and response-size limits. The resolver extracts Schema.org `Book`/`Product` data first and Open Graph metadata second. It accepts the image only after the page itself is verified against the book; search-result thumbnails are never accepted directly. A moderately different page title is accepted only with a strong author match, including Greek/Latin transliteration.

Metadata-cover candidates are scored using:

- title similarity: up to 700 points;
- publisher similarity: up to 180 points;
- author similarity: up to 120 points.

A candidate is accepted only when it has one of these evidence combinations:

- an exact normalized, distinctive title containing at least four tokens;
- an exact normalized title corroborated by author or publisher;
- a near-exact title corroborated by author or publisher.

This conservative gate prevents ambiguous titles from receiving unrelated covers. Accepted candidates are stored in `metadata_cover_candidates`; only the highest-ranked candidate is selected. The application serves it through `/api/covers/metadata/{copyId}`, which validates the source host, response type, and 8 MB size limit before applying shared caching. Metadata resolution never invents or assigns an ISBN.

Metadata-provider requests make a bounded set of attempts within the active ingestion request. No persistent metadata retry job is created.

When a verified web-page match has a moderately similar title and a strong author match (including Greek/Latin transliteration), the corrected title replaces the display title. The literal Stage 1 title is retained in `works.observed_title` together with the correction source and confidence. Cover selection remains representative unless edition evidence independently justifies assigning an ISBN.

## 4. Owner corrections

On an owned collection page, the owner can:

- select any retained edition candidate, changing both ISBN and cover;
- enter an ISBN manually, which is validated and canonicalized before use.

Owner decisions retain separate provenance and are not silently overwritten by subsequent automatic matching.

Rejecting an edition records durable feedback, removes an automatic selection when necessary, and prevents the same ISBN from being proposed again for that physical copy.

## Provider safety and operations

- Only canonical, checksum-valid ISBNs reach ISBN cover resolution.
- Backend-discovered third-party images are proxied or redirected through controlled application routes. Assistant-supplied public HTTPS images are rendered directly and retain explicit source provenance.
- Provider hosts are allowlisted and response content types and sizes are validated.
- ISBN and ISBN-cover provider outages remain distinct from genuine `not found` results.
- Covers and negative results are cached to control latency and provider usage.
- The original shelf photograph is not required or retained by cover resolution.

See [ISBN_MAPPING.md](ISBN_MAPPING.md) for the provider roadmap and edition-review rules, and [INGESTION_PIPELINE.md](INGESTION_PIPELINE.md) for the full Stage 1–4 choreography.
Credential-dependent and web-page providers are tracked in [PROVIDER_INTEGRATIONS.md](PROVIDER_INTEGRATIONS.md).
