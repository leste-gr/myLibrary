# Stage 1 — manual GenAI shelfie extraction

Status: superseded by the review flow on `feature/connected-shelfie-import`; the v1 payload contract below remains supported. See [connected assistant setup](CONNECTED_ASSISTANT_SETUP.md). The historical journey and non-goals below describe the previous implementation.

Schema: `mylibrary.shelfie.v1`  
Last updated: 10 October 2026

## Purpose

Stage 1 turns a shelf photograph into structured book observations without myLibrary uploading the photograph or calling an AI provider. The owner uses a GenAI chat they already have access to, then manually uploads the resulting JSON to myLibrary.

This replaces the in-product YOLO, OpenCV, and PaddleOCR worker. It does not create an integration with ChatGPT or any other model provider.

## User journey

1. The signed-in owner opens **Import shelfie** from one of their collection pages.
2. myLibrary displays a provider-neutral prompt and a copy button.
3. The owner opens a GenAI chat of their choice, attaches the shelf photograph there, and sends the prompt.
4. The chat returns JSON only. The owner saves that response as a `.json` file.
5. In myLibrary, the owner chooses an existing collection or enters a name and optional description for a new collection.
6. The owner uploads the JSON file. myLibrary validates the complete file before writing anything.
7. A single authenticated database transaction creates the import record, works, copies, source observations, and any visible-ISBN candidates. Creating a new destination collection happens immediately before that transaction; the client removes it if the import reports an error.
8. Stage 2 queries bibliographic providers, stores its ranked ISBN candidates, and automatically selects the leader before the owner lands on the collection page. Provider failures can be retried there.

The shelf photograph is sent directly from the owner to their chosen chat. myLibrary never receives, stores, proxies, or deletes it. The provider's own privacy policy and retention settings apply.

## Contract

The root object must have exactly the supported schema version and a non-empty `books` array:

```json
{
  "schemaVersion": "mylibrary.shelfie.v1",
  "books": [
    {
      "position": 1,
      "title": "Required visible title",
      "subtitle": null,
      "authors": [],
      "publisher": null,
      "language": null,
      "publicationYear": null,
      "editionStatement": null,
      "series": null,
      "volume": null,
      "visibleIsbn": null,
      "confidence": 0.9,
      "notes": null
    }
  ]
}
```

Validation rules:

- The file must be valid JSON, no larger than 1 MB, containing 1–100 books.
- `position` is a unique integer from 1–100. Books are imported in ascending position order.
- `title` is required; optional unknown text values use `null` and unknown authors use `[]`.
- `authors` contains at most ten non-empty names.
- `confidence` is a number from 0 through 1.
- `publicationYear` is `null` or an integer from 1400 through 2100.
- `visibleIsbn` is `null` or a valid ISBN-10/ISBN-13. ISBN-10 values are normalized to ISBN-13 before import.
- Invalid input creates no books. The client and database both validate critical constraints.

## Import semantics

- The import is atomic: either every validated book is created or none is.
- A SHA-256 checksum prevents the same book array being imported twice into the same collection.
- Imported copies are immediately visible, consistent with automatic Stage 1 population. Owner fine-tuning remains optional.
- Each book creates a `manual_genai_json` observation containing the submitted fields, confidence, schema version, and import ID.
- A valid `visibleIsbn` creates a high-priority edition candidate. It does not masquerade as an owner-confirmed ISBN.
- The import record stores the JSON checksum and book count, not the source photograph.

## Prompt requirements

The shipped prompt instructs the external chat to return JSON only with the exact schema, produce one record per physical spine, preserve shelf order, avoid invented facts, supply only visibly readable ISBNs, retain unreadable books with an uncertainty note, and keep repeated copies separate.

The prompt is product code in `lib/manual-genai-import.ts`. Any field or meaning change requires a new schema version and compatible database importer.

## Failure states

| Failure | Behaviour |
| --- | --- |
| Chat adds Markdown fences or prose | Local JSON parsing fails; the owner removes the extra text or asks the chat for JSON only. |
| Wrong schema or invalid field | Validation names the failing book and field; nothing is imported. |
| Duplicate JSON | The importer reports that the file was already imported; no duplicate copies are created. |
| New collection creation succeeds but import fails | The newly created empty collection is removed by the client. |
| Network/database failure | The database transaction rolls back all import writes. |
| Low-confidence extraction | The book is imported with its confidence and notes so the owner can refine it. |

## Acceptance criteria

- A signed-in owner can copy the prompt and upload a conforming JSON file into an existing or new collection.
- No shelf image is uploaded to myLibrary and no model-provider API is called by the application.
- Invalid and duplicate payloads cannot create partial or repeated book sets.
- Imported observations retain enough structured evidence for Stage 2 ISBN candidate generation.
- A visibly supplied valid ISBN becomes an edition candidate and uses the existing ISBN cover route.
- Public visitors cannot execute imports, and ownership is checked again in the database function.

## Non-goals

- OAuth, account linking, browser extensions, chat actions, or provider APIs.
- Verifying the external model's identity or accuracy.
- Storing, annotating, or reprocessing shelf photographs.
- Treating generated ISBNs as trustworthy when they were not visibly read.
- Completing edition selection or cover ranking in Stage 1; those remain downstream stages.

