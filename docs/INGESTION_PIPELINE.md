# myLibrary ingestion pipeline

This is the canonical contract for turning a shelfie into published books. Detailed Stage 1 behaviour is specified in [STAGE_1_MANUAL_GENAI_IMPORT.md](STAGE_1_MANUAL_GENAI_IMPORT.md). ISBN and non-ISBN cover methods are specified in [COVER_RESOLUTION.md](COVER_RESOLUTION.md).

`owner's shelfie → external GenAI chat → manual JSON upload → ISBN candidates → selected edition → ISBN cover → optional owner correction`

## Current stages

| Stage | Status | Output |
| --- | --- | --- |
| 1. Extract visible book data | Implemented | The owner uses the supplied prompt in a GenAI chat of their choice and uploads schema-validated JSON. myLibrary does not receive the image or call the provider. |
| 2. Identify ISBN | Implemented | Every manual GenAI import checks the reviewed local catalogue and queries Open Library and Google Books, retains up to ten ranked ISBN candidates per book, and selects the leader. A valid ISBN visibly supplied in Stage 1 remains the strongest candidate. |
| 3. Resolve cover | Implemented | The selected ISBN is served through the cached `/api/covers/{isbn}` provider cascade. Conservative title/author/publisher matching supplies a non-ISBN fallback when no edition can be mapped. |
| 4. Owner refinement | Implemented | On their public collection page, the owner can inspect candidates, choose an edition, or enter an ISBN manually. |

Stage 2 progress is stored on the import record. Interrupted, partial, and failed matches remain visible to the owner on later visits and can be retried without uploading the JSON again. A processing attempt older than ten minutes is treated as stale. Provider rate limits, timeouts, and 5xx responses remain retryable with exponential backoff; they are never converted into permanent unresolved results merely because another provider returned an empty response.

Stage handoffs use database statuses rather than direct calls between ingestion sources. Any Stage 1 producer finishes by writing an import with `matching_status = pending` and observations with `status = ready_for_matching`. That database event asynchronously dispatches the pipeline; scheduled polling remains only a recovery fallback. Stage 2 claims the pending record atomically. Selecting an ISBN creates a `cover_resolution_jobs` record with `status = pending`; the independent Stage 3 processor resolves and warms the cached cover route, then records `completed`, `missing`, or `failed`. `missing` means every available provider returned a genuine absence; rate limits, timeouts, and server errors use `failed` with `next_retry_at`. This choreography is identical for web uploads, MCP imports, and future ingestion workers.

## Stage handoffs

### Stage 1 → Stage 2

Every imported physical spine creates a published copy, a work, and a `manual_genai_json` observation containing normalized title, authors, publisher, language, edition clues, confidence, notes, position, and any visibly read ISBN. New Stage 1 payloads also preserve `rawVisibleText` and per-field confidence so a speculative interpretation remains distinguishable from the literal spine reading. The original JSON is represented by an import checksum; the shelf photograph remains outside myLibrary.

Stage 2 must always select its strongest ISBN candidate automatically while retaining the remaining candidates for owner selection. A valid, visibly read ISBN is stronger evidence than a bibliographic text match but remains distinguishable from an owner override.

### Stage 2 → Stage 3

Cover resolution begins with a canonical ISBN-13. Results and negative lookups are cached by ISBN. The public catalogue uses the stable local cover route, not third-party URLs directly.

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
