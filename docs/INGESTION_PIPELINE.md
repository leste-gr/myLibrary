# myLibrary ingestion pipeline

This is the canonical contract for turning a shelfie into published books. Detailed Stage 1 behaviour is specified in [STAGE_1_MANUAL_GENAI_IMPORT.md](STAGE_1_MANUAL_GENAI_IMPORT.md).

`owner's shelfie → external GenAI chat → manual JSON upload → ISBN candidates → selected edition → ISBN cover → optional owner correction`

## Current stages

| Stage | Status | Output |
| --- | --- | --- |
| 1. Extract visible book data | Implemented | The owner uses the supplied prompt in a GenAI chat of their choice and uploads schema-validated JSON. myLibrary does not receive the image or call the provider. |
| 2. Identify ISBN | Partially implemented | Existing catalogue metadata produces ranked edition candidates. A valid ISBN visibly supplied in Stage 1 becomes a high-priority candidate; automatic candidate lookup for all newly imported observations is next. |
| 3. Resolve cover | Implemented for mapped ISBNs | The selected ISBN is served through the cached `/api/covers/{isbn}` provider cascade. Non-ISBN fallback remains a future enhancement. |
| 4. Owner refinement | Implemented | On their public collection page, the owner can inspect candidates, choose an edition, or enter an ISBN manually. |

## Stage handoffs

### Stage 1 → Stage 2

Every imported physical spine creates a published copy, a work, and a `manual_genai_json` observation containing normalized title, authors, publisher, language, edition clues, confidence, notes, position, and any visibly read ISBN. The original JSON is represented by an import checksum; the shelf photograph remains outside myLibrary.

Stage 2 must always select its strongest ISBN candidate automatically while retaining the remaining candidates for owner selection. A valid, visibly read ISBN is stronger evidence than a bibliographic text match but remains distinguishable from an owner override.

### Stage 2 → Stage 3

Cover resolution begins with a canonical ISBN-13. Results and negative lookups are cached by ISBN. The public catalogue uses the stable local cover route, not third-party URLs directly.

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

Run the existing ISBN candidate generator for each new `manual_genai_json` observation, persist every viable candidate, automatically select the most likely candidate, and queue cover resolution for that ISBN. The owner can then correct the result from the collection page.
