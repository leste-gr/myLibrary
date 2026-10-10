# myLibrary product roadmap

Status: Draft for product discussion  
Last updated: 10 October 2026
Working product name: **myLibrary**

## 1. Product direction

myLibrary should become a private-first tool for turning photographs of physical bookshelves into a reliable, editable catalogue, with an attractive public view of the collection.

The central product promise is:

> Turn a shelfie into structured book data, then automatically find the most likely ISBN and cover while keeping every decision editable.

The product should automate discovery without pretending that visual or bibliographic matches are certain. The owner remains in control of which physical book, edition, ISBN, and cover are published.

## 2. Current baseline

The product is a Next.js and Supabase application with per-user collections, public collection URLs, owner-aware editing on the public page, ranked edition candidates, manual ISBN entry, and ISBN-based cover resolution. The original catalogue remains available as bundled fallback data.

Stage 1 shelfie ingestion uses a manual handoff: myLibrary gives the owner a versioned prompt; the owner attaches the photo in a GenAI chat of their choice and uploads only its JSON response. myLibrary has no model-provider integration and never receives the shelf photograph.

## 3. Product principles

1. **A physical copy is not the same thing as a title or edition.** Keep the owner's copy, the abstract work, and the published edition as separate concepts.
2. **Automation proposes; the owner confirms.** Low-confidence recognition must never silently overwrite catalogue data.
3. **Prefer deterministic identifiers.** A valid ISBN or barcode is cheaper and more reliable than repeated image or language-model searches.
4. **Reuse results.** Cache metadata, candidates, and cover assets by normalized ISBN so that the same work is never paid for twice.
5. **Let owners choose the extraction provider.** Stage 1 uses the owner's external GenAI chat and a portable JSON contract; myLibrary itself spends no model tokens and stores no shelf photographs.
6. **Preserve provenance and history.** Every selected edition, edited ISBN, and cover should record its source and be reversible.
7. **Keep the public catalogue fast.** Generate static public assets from reviewed data even if the owner workflow uses a backend.
8. **Make uncertainty visible.** Confidence, unresolved fields, and suspected duplicates belong in a review queue.

### Edition-cover assumption

For the initial product, myLibrary assumes that each unique valid ISBN identifies one cover edition. The ISBN is therefore the primary key for cover lookup and caching. Distinct physical copies may share an ISBN, while books without an ISBN continue to use a manually reviewed edition record.

## 4. Primary users and jobs

### Library owner

The owner wants to capture shelves quickly, correct recognition mistakes, choose the exact editions they own, and publish a trustworthy catalogue without editing JSON.

### Catalogue visitor

A visitor wants to browse, search, filter, and inspect the collection quickly on desktop or mobile. Visitors should not see maintenance controls or unreviewed imports.

### Future collaborator

A trusted collaborator may help review matches and metadata. This is a later role and should use explicit permissions and an audit trail.

## 5. Core domain model

The present `books.json` record mixes physical-copy data, work metadata, edition metadata, recognition results, and cover data. Separate these concerns before building the editing workflow.

### Work

The intellectual work independent of publication: canonical title, contributors, series, subjects, and original language.

### Edition

A published edition of a work: ISBN-10, ISBN-13, publisher, publication date, language, format, page count, and candidate covers. An edition may have no ISBN, especially for older books.

### Copy

The physical item owned by the user: stable internal ID, selected edition, shelf/location, acquisition and reading state, notes, condition, and visibility. Existing IDs such as `B001` remain stable copy IDs.

### Manual GenAI import and observation

A versioned JSON batch plus ordered book observations. Each observation retains extracted fields, confidence, candidate matches, review status, and a link to its copy. The source image remains with the external chat provider and is not part of the myLibrary data model.

### Cover asset

A selected local image plus source URL, provider, retrieval time, dimensions, checksum, license/provenance notes, and its relationship to an edition. Failed and rejected candidates should be retained as metadata so they are not fetched again.

### Audit event

Who or what changed a field, the old and new values, the source, and the timestamp. Automated suggestions and human confirmations must be distinguishable.

## 6. User stories and acceptance criteria

### US-1: Update the library from a shelfie

**As the owner, I want to use a supplied prompt with my own GenAI chat and upload the resulting JSON so that I can add books without re-entering my collection.**

Acceptance criteria:

- The owner can copy a provider-neutral prompt from myLibrary.
- The owner sends the photograph directly to a GenAI chat of their choice; myLibrary never receives it.
- The response uses the versioned `mylibrary.shelfie.v1` JSON contract and preserves physical shelf order.
- The app validates the entire file locally and in the database before creating any books.
- One atomic import can target an existing collection or create a named collection with an optional description.
- Re-uploading the same book array to a collection is idempotent and does not create duplicate copies.
- Extracted title, author, publisher, language, edition clues, visible ISBN, confidence, and notes are retained as source observations.
- Imported books are populated automatically; correction by the owner is an optional downstream override.

Suggested experience:

1. Photograph the shelf clearly.
2. Copy the myLibrary prompt into the owner's chosen GenAI chat and attach the photo there.
3. Save the JSON-only response.
4. Upload the JSON to an existing or new collection.
5. Let ISBN matching and cover resolution run downstream, then optionally refine the result on the collection page.

### US-2: Select the correct edition

**As the owner, I want to choose an edition from ranked candidates so that the catalogue describes the physical book I own.**

Acceptance criteria:

- Candidate editions show cover, title, contributors, publisher, publication date, language, format, and ISBN.
- Exact barcode or ISBN matches rank first, followed by title/author/publisher/language similarity.
- The interface explains why each candidate matched and identifies conflicting fields.
- The owner can search again, scan/type an ISBN, choose “none of these,” or create a manual edition.
- Selecting an edition does not overwrite copy-specific notes or the stable copy ID.
- Changing an edition shows a preview of affected metadata and cover before saving.
- The selected provider identifiers and matching evidence are retained for provenance.

### US-3: View and edit ISBNs

**As the owner, I want to see and correct ISBN values so that wrong edition mappings can be repaired.**

Acceptance criteria:

- Book details and edit mode show ISBN-13 and ISBN-10 where available.
- The editor accepts digits, spaces, and hyphens, normalizes them, validates check digits, and converts between ISBN-10 and ISBN-13 when valid.
- Invalid ISBNs are clearly marked and cannot silently trigger metadata replacement.
- Editing an ISBN performs a lookup and presents any proposed edition change for confirmation.
- ISBN history records the prior value, new value, source, editor, and time.
- Books without an ISBN remain supported and can be marked “no ISBN” or “unknown.”
- Search accepts ISBN-10 and ISBN-13 forms.

### US-4: Fetch covers faster, more cheaply, and more accurately

**As the owner, I want covers to be resolved efficiently so that imports finish quickly, use few paid tokens, and select the correct edition artwork.**

Acceptance criteria:

- Cover lookup starts only after an edition or strong bibliographic candidate exists.
- The system queries providers by normalized ISBN before using fuzzy title searches.
- Provider responses and negative results are cached with an expiry policy.
- Candidate images are downloaded once, verified as images, deduplicated by checksum/perceptual hash, resized, and stored locally.
- Tiny placeholders and low-quality images are rejected using deterministic checks.
- Covers are ranked using edition identity, publisher, language, dimensions, aspect ratio, and optional visual similarity with a shelf crop.
- A language/vision model is called only when deterministic ranking cannot produce a confident answer.
- The owner can compare candidates, upload a cover, retain no cover, or crop the cover from another photo.
- The chosen cover retains provider, source URL, retrieval date, and confidence.
- Batch processing reports cache-hit rate, provider calls, model calls, duration, and estimated cost.

Recommended lookup cascade:

1. Existing local asset or ISBN cache.
2. ISBN barcode extracted from the book or entered by the owner.
3. Free bibliographic providers queried by ISBN.
4. Provider candidate ranking with deterministic metadata rules.
5. Fuzzy title/author/publisher search if ISBN is absent.
6. Visual comparison of a few candidates with the spine or cover crop.
7. Vision/language-model assistance only for ambiguous records.
8. Manual review.

### US-5: Review and publish a batch

**As the owner, I want one review queue for proposed changes so that automation remains safe and efficient.**

Acceptance criteria:

- A batch summarizes additions, edition changes, metadata edits, duplicates, unresolved detections, and cover changes.
- Filters expose low confidence, missing ISBN, missing cover, conflicts, and validation errors.
- Bulk approval applies only to proposals above a configurable confidence threshold and with no conflicts.
- Publishing is atomic: either the reviewed batch is applied, or the previous catalogue remains active.
- The owner can undo a published batch or restore an earlier catalogue version.
- The public catalogue never displays partial or unreviewed imports.

### US-6: Edit a book directly

**As the owner, I want to edit catalogue data in the app so that routine corrections do not require Git or JSON.**

Acceptance criteria:

- The owner can edit work, edition, copy, and cover fields from a clearly separated form.
- Required fields and controlled values are validated before save.
- Changes are previewed and recorded in history.
- Potential duplicate copies or editions are surfaced without blocking intentional duplicates.

### US-7: Find catalogue work that needs attention

**As the owner, I want data-quality views so that I can improve the collection over time.**

Acceptance criteria:

- Saved views include missing ISBN, missing cover, uncertain identity, incomplete publisher, possible duplicate, and recently changed.
- A collection health summary counts complete, incomplete, and unresolved records without turning quality into an opaque score.
- Every issue links directly to the relevant editor or candidate review.

### US-8: Scan a single book quickly

**As the owner, I want to scan a barcode for one book so that small updates do not require a full shelf photo.**

Acceptance criteria:

- Mobile capture can scan EAN-13/ISBN barcodes locally where browser support permits.
- A valid scan performs an edition lookup and opens the same candidate-review flow.
- The owner can add a copy, link the edition to an existing copy, or cancel without creating data.

### US-9: Track ownership and reading context

This is an optional product expansion after catalogue maintenance works well.

- Shelf/location, reading status, rating, acquisition date/source, loan status, private notes, and tags belong to the copy.
- Fields can be private even when the book itself is public.
- Visitors may filter public fields such as shelf, tag, or reading status only when the owner enables them.

### US-10: Export and portability

**As the owner, I want full exports so that my catalogue is never locked into the service.**

- Export JSON and CSV, including ISBNs and provenance.
- Provide an archive of owned cover assets and a machine-readable schema version.
- Preserve a static-site export compatible with inexpensive hosting.
- Import validates a preview before modifying the library.

## 7. Proposed product shape

Use one collection experience with public and owner-aware modes:

### Public catalogue

Serve public collection pages from Next.js and Supabase, with cacheable cover URLs and read-only public database policies. The main page lists public collections, and each collection has a stable `/collections/{slug}` URL.

### Owner workspace

When an owner signs in and browses their own public collection, the same interface exposes edition candidates, typed ISBN input, draft review, and publishing controls. Ingestion jobs and future shelfie batches should enter this same review flow rather than creating a separate admin product.

Each authenticated user owns one collection. Supabase row-level security isolates mutations by collection while allowing public collections to remain readable.

## 8. Processing architecture

The canonical stage-by-stage contract is documented in [`INGESTION_PIPELINE.md`](INGESTION_PIPELINE.md). It separates implemented behavior from planned shelfie processing and defines the handoff between recognition, ISBN ranking, cover resolution, and owner review.

### Shelfie pipeline

`external GenAI extraction → manual JSON upload → validated observations → bibliographic candidates → edition ranking → cover resolution → optional owner refinement`

The Stage 1 boundary is a versioned JSON file. See [`STAGE_1_MANUAL_GENAI_IMPORT.md`](STAGE_1_MANUAL_GENAI_IMPORT.md) for its prompt, validation, privacy, idempotency, and acceptance criteria.

### Cost controls

- Hash normalized JSON book arrays to prevent duplicate imports.
- Keep model images and tokens outside myLibrary by using the owner's chosen chat.
- Query bibliographic APIs with compact identifiers, not full images.
- Cache normalized provider results by ISBN and provider record ID.
- Limit candidate sets before visual or language-model ranking.
- Version the portable prompt and response schema in the application.

### Cover provider strategy

Use a provider adapter interface rather than binding the product to one catalogue. Begin with sources that have usable terms and strong ISBN lookup, such as Open Library and Google Books, then add country- or language-specific sources where licensing and access permit. Provider order must be configurable. Store cover images locally after selection so public page loads do not depend on provider uptime or leak visitor requests.

Provider terms, image rights, attribution requirements, rate limits, and caching permissions require review before implementation. A technically reachable image is not automatically licensed for permanent reuse.

## 9. Data migration proposal

Before adding shelfie ingestion:

1. Define and version schemas for works, editions, copies, shelfies, detections, cover assets, and audit events.
2. Migrate each current `Bxxx` record to a copy while preserving its public URL fragment and display order.
3. Create provisional work and edition records from existing fields.
4. Treat all current cover-to-edition links as unverified until an edition is selected; retain their existing provenance.
5. Add nullable `isbn10` and `isbn13` edition fields. Do not invent ISBN values during migration.
6. Generate the current public `books.json` format during a compatibility period.
7. Add schema validation and a migration test using all 166 current records.

## 10. Roadmap

### Phase 0 — Foundations and decisions

Goal: make the existing catalogue safe to evolve.

- Agree on owner-only versus future multi-user scope.
- Define the domain schemas and catalogue export contract.
- Choose authentication, database, object storage, job execution, and deployment approach.
- Add schema validation, data migration, catalogue generation, and backups.
- Establish provider terms and a cover provenance policy.
- Instrument a baseline: correction rate, cover success, processing time, provider/model calls, and cost.

Exit criterion: all 166 records migrate without losing stable IDs, visible metadata, cover files, or provenance, and the generated public catalogue remains functionally equivalent.

### Phase 1 — Metadata editor and edition identity (MVP)

Goal: fix the data manually before automating shelf recognition.

- Owner authentication.
- Book editor separated into copy, work, and edition fields.
- ISBN display, validation, edit history, and lookup.
- Ranked edition picker with manual edition creation.
- Cover candidate picker using the deterministic ISBN-first cascade.
- Data-quality queues and publish preview.
- Versioned publish and rollback.

Exit criterion: the owner can correct an ISBN, select an edition and cover, publish it, and undo the change without editing repository files.

### Phase 2 — Single-book and assisted imports

Goal: make common additions fast and validate provider quality.

- Mobile barcode scan and typed ISBN import.
- Single cover/spine photo import.
- Duplicate detection against existing copies.
- Reusable metadata and cover cache.
- Batch metrics for speed, API calls, model calls, and cost.

Exit criterion: a clear-barcode book can be added and published in under one minute with no paid model call in the normal path.

### Phase 3 — Manual GenAI shelfie ingestion

Goal: turn an externally interpreted shelf photo into a validated collection import without an in-product AI integration.

- Versioned, provider-neutral extraction prompt and JSON schema.
- Copy-prompt and manual JSON-upload journey.
- Atomic import into an existing or newly named collection.
- Structured source observations and duplicate-import protection.
- Automatic handoff to ISBN candidate ranking and cover resolution.
- Optional corrections on the owner's public collection page.

Exit criterion: a conforming JSON response imports all detected books in shelf order with no image stored by myLibrary, and invalid or repeated files create no partial or duplicate data.

### Phase 4 — Incremental shelf reconciliation

Goal: update an existing shelf rather than rebuild it.

- Match a new shelfie to a previous shelf and align overlapping images.
- Propose additions, removals, moves, and unresolved differences.
- Track shelf/location and last-seen evidence.
- Improve cover selection with visual similarity and correction feedback.

Exit criterion: a small shelf change produces a short review focused on the changed books, without duplicating unchanged copies.

### Phase 5 — Collection experience

Goal: build useful features on trusted catalogue data.

- Reading state, ratings, tags, acquisition, location, lending, and private notes.
- Wishlist and “do I own this?” barcode lookup.
- Optional recommendations and collection insights.
- Trusted collaborator role if needed.
- Rich exports and integrations.

Exit criterion: prioritize from observed usage rather than implementing the whole phase as a bundle.

## 11. Success measures

Measure the product at the level where the owner experiences value:

- Median active owner time per correctly onboarded book.
- Percentage of imported books published without metadata correction.
- Percentage of selected editions with validated ISBNs.
- Correct-cover rate after owner review.
- Duplicate proposal and duplicate-publication rates.
- Low-confidence observations per import.
- Cache hit rate and external provider requests per book.
- External GenAI usage is outside myLibrary; the application makes zero paid model calls in Stage 1.
- Median shelfie processing time and publish time.
- Rollback frequency and edits made within seven days of import.

Initial numerical targets should be set only after a small, labeled test set establishes the baseline. Optimize for correctness and owner time before raw recognition rate.

## 12. Security, privacy, and reliability requirements

- Owner maintenance routes require authentication; public browsing remains read-only.
- Shelf photographs are never uploaded to myLibrary in the Stage 1 manual GenAI flow.
- Clearly tell owners that the privacy and retention terms of their chosen chat provider apply.
- Validate JSON file type, size, schema, and field limits before database writes.
- Keep provider/API credentials server-side and out of browser bundles and generated static files.
- Back up the database and selected cover assets; test restoration.
- Use atomic publishing and immutable catalogue versions.
- Rate-limit uploads and metadata lookups.
- Provide account and data export/deletion controls before supporting additional users.

## 13. Explicit non-goals for the first release

- Fully automatic shelf recognition with no owner review.
- General-purpose social network or public user registration.
- Native iOS or Android applications before the mobile web flow is proven.
- Replacing bibliographic providers with a model-generated source of truth.
- Building recommendations before edition identity and catalogue maintenance are dependable.
- Automatically treating a missing book in one photo as removed from the collection.

## 14. Product decisions still needed

These decisions change implementation scope and should be resolved before Phase 1 engineering:

1. Is myLibrary permanently for one owner, or should its design anticipate separate libraries for family or public users?
2. Should the source database live in a hosted service, with GitHub as an export/deployment target, or should reviewed changes be committed directly to GitHub?
3. Should a future direct-image workflow ever be added, or should the provider-neutral manual handoff remain the permanent trust boundary?
4. Which book fields and reading information are private versus public?
5. Should a shelfie represent evidence of ownership, shelf location, or both?
6. Which Greek bibliographic and bookseller sources may be used under their access and image terms?
7. What monthly budget and maximum processing time are acceptable for ISBN metadata and cover fetching? Stage 1 itself has no application-paid model usage.
8. Is exact edition matching required for every book, or can some records remain at work/title level?

## 15. Recommended next product slice

Start with the ISBN and edition editor plus the cover lookup cascade. It directly delivers three of the four requested capabilities, creates the data needed to evaluate providers, and avoids building shelf recognition on top of ambiguous edition records.

The first vertical slice should let the owner open `B001`, enter or scan an ISBN, review edition candidates, select a cover, preview the change, publish it, and roll it back. Instrument every lookup and cache result. Once this works across a representative set of Greek and non-Greek books, use the same candidate and review components inside the shelfie workflow.
