# myLibrary ingestion pipeline

This is the canonical contract for turning a shelfie into published books. Detailed Stage 1 behaviour is specified in [STAGE_1_MANUAL_GENAI_IMPORT.md](STAGE_1_MANUAL_GENAI_IMPORT.md). ISBN and non-ISBN cover methods are specified in [COVER_RESOLUTION.md](COVER_RESOLUTION.md).

`owner's shelfie → external GenAI chat/MCP → book data + optional ISBN/cover → backend fallback when needed → optional owner correction`

## Current stages

| Stage | Status | Output |
| --- | --- | --- |
| 1. Extract and research book data | Implemented | The prompt identifies shelf books, then asks the user's LLM to verify an edition ISBN and direct public cover image. The same schema supports MCP and manual JSON upload. |
| 2. Identify ISBN fallback | Implemented | Runs only for imported books without `coverUrl`; it retains ranked candidates and selects the leader. |
| 3. Resolve cover fallback | Implemented | Runs only when Stage 1 did not supply a cover. It owns selected-ISBN, representative candidate, and metadata cover detection, in that order. |
| 4. Owner refinement | Implemented | On their public collection page, the owner can inspect candidates, choose an edition, enter an ISBN manually, or upload an image file to use as cover. |

Stage 2 progress is stored on the import record. Processing starts from the database insertion event and from the hourly Supabase `pg_cron` job `mylibrary-hourly-ingestion-retry`, scheduled at minute zero of every hour. Both invoke the same dispatcher and worker. Failed lookups become eligible at the next hourly tick. Processing claims older than ten minutes can be recovered. Atomic row claims prevent overlapping workers from processing the same book.

Each book has a `cover_status`: `pending → processing → completed | cover_not_found | failed`. A genuine negative lookup becomes `cover_not_found` and is excluded from subsequent runs. Timeouts, rate limits and incomplete provider searches become `failed`, with an error and next retry time. Existing covers are marked completed. Changing the edition or removing a cover reopens its cover work.

Import `matching_status` describes Stage 2 only. The separate `ingestion_status` becomes `completed` once matching has finished and every remaining book has a cover or a terminal `cover_not_found` result. It remains pending, processing or failed while work needs attention. Completion is maintained by database triggers, including when books are removed or an owner supplies a cover.

Stage handoffs use database statuses rather than direct calls between ingestion sources. A supplied cover marks its observation `cover_provided` and is excluded from Stage 2. If every imported book has a cover, the import is completed immediately. Otherwise the import remains `pending`, and Stage 2 selects only `ready_for_matching` observations. A supplied ISBN+cover also completes its ISBN cover job so Stage 3 cannot refetch it.

## Stage handoffs

### Stage 1 → Stage 2

Every imported physical spine creates a published copy, a work, and a `manual_genai_json` observation containing normalized metadata and provenance. `visibleIsbn` preserves a checksum-valid number read from the photo; `isbn` may additionally contain a number verified from a matching edition page. `coverUrl` carries a direct public HTTPS image. The original JSON is represented by an import checksum; the shelf photograph remains outside myLibrary.

Stage 2 must always select its strongest ISBN candidate automatically while retaining the remaining candidates for owner selection. A valid, visibly read ISBN is stronger evidence than a bibliographic text match but remains distinguishable from an owner override.

### Stage 2 → Stage 3

Stage 2 only identifies, ranks, and selects ISBN candidates. It does not probe images or assign cover assets. Edition selection queues an ISBN lookup for Stage 3. Stage 3 first resolves selected-ISBN jobs and attaches successful cover assets, then probes strong representative candidates, then searches metadata for copies still without covers. Candidate and metadata discovery only consider observations whose ISBN matching has finished.

Stage 3 claims up to 100 books per request within the worker time budget. Each claimed book follows its applicable selected-ISBN or candidate/metadata path. A failure on one import or book does not prevent other eligible work from running. Work left by the batch or time limit is picked up on the next dispatch.

Backend cover resolution begins only when Stage 1 did not provide a cover. Its results and negative lookups are cached by ISBN. Assistant-supplied public images retain `assistant-supplied` provenance and are used directly by that copy.

When Stage 2 cannot select an ISBN, Stage 3 may instead select a conservative metadata cover using title, author, and publisher evidence. That fallback provides an image only and does not create an ISBN or edition mapping.

### Stage 3 → Stage 4

Automation publishes its best result, while alternative edition candidates and their evidence remain available to the owner. An owner selection or manually entered ISBN is audited as an override and is not silently replaced by later automation.

## Cross-stage guarantees

- A physical copy, work, and edition remain separate records.
- Stage 1 imports are atomic and idempotent within a collection.
- Invalid ISBNs never trigger metadata or cover replacement.
- Original shelf photographs are never sent to or stored by myLibrary in the manual GenAI flow.
- Provider results and covers are cached by normalized identifiers.
- Public rendering never waits for ingestion or provider calls.
- Automated evidence and owner decisions retain distinct provenance.

## Next implementation priority

Measure Stage 2 accuracy on owner corrections, improve edition-specific scoring when title-only metadata produces ties, and retain provider response caching so repeated imports avoid redundant lookups.

## Owner-requested Stage 2 search

The edit-book page's Find ISBN candidates button runs the shared Stage 2 providers and ranker for that copy alone, irrespective of matching or cover status. It does not claim an ingestion job or update book, observation, ingestion, or cover statuses. Results are stored as review-only candidates and displayed in ranking order; database triggers and later automatic selection exclude them. Even a high-confidence result requires an explicit owner selection and publication. Searches with no candidates clear the displayed search results and show “No ISBNs were matched,” including when providers are unavailable or quota-limited. Partial results remain ranked, with an informational notice when a provider was unavailable. Existing rejected candidates remain excluded. Normal ingestion retains its automatic matching behavior.

## Owner ISBN drafts and publishing

Manual ISBN entry and candidate selection both perform exact-ISBN metadata lookup against Open Library and Google Books, falling back to cached edition or candidate details. Results are stored privately in the copy draft. The edit page previews that draft's cover, title, author, publisher, language, and publication date before publication. An uploaded owner cover is retained and identified in the preview. Missing provider metadata is explained in the preview; existing book fields are retained where details are unknown. Publishing applies the draft metadata and edition atomically to this physical copy, using a separate work record so other books sharing the original work are unchanged. Saving or discarding a draft never publishes metadata changes.

If the primary ISBN providers have no metadata, owner ISBN lookup also checks web-discovered Book/Product metadata. A result must carry the exact chosen ISBN on that same record, including an explicitly labeled ISBN in its description; unrelated page-wide ISBNs are rejected. Sources are retained with the draft and published metadata. Titles inherited from older manual ISBN entries are not treated as verified ISBN metadata without source evidence.
