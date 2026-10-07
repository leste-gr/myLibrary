# myLibrary ingestion pipeline

This document defines how a physical book becomes a published record in a user's collection. It is the canonical pipeline contract for shelfie ingestion, ISBN mapping, cover resolution, and owner correction.

The pipeline is:

`shelfie → YOLO spine detection → OpenCV preprocessing → PaddleOCR observations → ISBN candidates → selected edition → ISBN cover → owner review → published copy`

Each stage must retain its inputs, outputs, evidence, confidence, and failures. A later stage must not erase the alternatives produced by an earlier stage.

## Status

| Stage | Status | Current implementation |
| --- | --- | --- |
| 1. Extract book data from a shelfie | Runtime and detector implemented; deployment required | A CPU worker detects spines with fine-tuned YOLO/ONNX Runtime, preprocesses crops with OpenCV, and runs Greek/English PaddleOCR. The selected checkpoint scored 0.913 mAP@50 and 0.547 mAP@50–95 on the held-out Roboflow test split. |
| 2. Identify an ISBN from book data | Implemented for existing metadata | The mapper ranks candidates and automatically publishes rank 1. Owner-confirmed overrides are protected from later algorithm runs. Shelfie-derived observations are not implemented yet. |
| 3. Resolve a cover from ISBN | Implemented | `/api/covers/{isbn}` uses Open Library, Google Books, the existing bundled cover, then a generated placeholder. Successful results are cached at the Vercel edge. |
| 4. Owner editing and selection | Implemented | A signed-in owner edits books from their public collection, can select any retained candidate, or can enter an ISBN-10/ISBN-13 manually and publish the draft. |

The default spine detector training source is BookDetection’s Roboflow `book-spine-detector` v4 dataset, licensed CC BY 4.0. Dataset provenance and licensing must remain attached to every trained detector artifact.

## Pipeline invariants

1. A physical copy, work, and edition remain separate records.
2. A normalized, checksum-valid ISBN-13 is the preferred edition identifier.
3. When ISBN candidates exist, the ranking algorithm must select exactly one rank-1 candidate as its current best answer.
4. Every non-selected candidate is retained for owner review; selecting one candidate must not delete the others.
5. An algorithmic selection and an owner-confirmed selection are different states.
6. A cover selected from an ISBN belongs to the edition, while notes, shelf position, and ownership belong to the physical copy.
7. Every manual correction records provenance and must be reversible.
8. Books with no ISBN remain valid collection records.

## 1. Get book data from a shelfie

Status: **implemented**.

### Input

- One or more shelf photographs owned by the signed-in user.
- Capture metadata such as upload time, image dimensions, orientation, and optional shelf/location label.

### Processing

1. The owner uploads one shelf photograph into a private Supabase bucket.
2. A finite GitHub Actions worker atomically claims queued jobs, processes the available queue, and exits.
3. A fine-tuned Ultralytics YOLO detector runs through ONNX Runtime on CPU and returns non-overlapping spine boxes in shelf reading order.
4. Each spine is cropped with small padding, rotated +90° and -90°, upscaled with bicubic interpolation, and enhanced with CLAHE in LAB luminance space.
5. Greek and English PaddleOCR models evaluate both rotations. The language and rotation with the best character-weighted confidence are retained.
6. OCR lines, boxes, language, detector confidence, rotation, and aggregate confidence are persisted as observations and tokens. Crops are never stored.
7. The source image is deleted before the job can be marked complete. After the final failed attempt, the worker also attempts deletion and records any deletion failure.

### Output

Each detected physical book should produce an observation record similar to:

```json
{
  "detectionId": "uuid",
  "shelfieId": "uuid",
  "cropAssetId": "uuid",
  "titleText": "The Fire",
  "authorText": "Katherine Neville",
  "publisherText": null,
  "languageHint": "en",
  "barcodeText": null,
  "confidence": 0.82,
  "status": "ready_for_matching"
}
```

Poor-quality or empty OCR results remain unresolved rather than being silently discarded. Source photos and transient crops are not retained after extraction.

## 2. Identify ISBN from book data

Status: **implemented for existing catalogue metadata; shelfie-derived candidate generation remains planned**.

### Candidate sources

Use evidence in descending reliability:

1. A valid ISBN/EAN barcode visible in the shelfie or another book photo.
2. A manually entered, checksum-valid ISBN.
3. An ISBN from an exact edition-level source.
4. Structured ISBN metadata from an existing trusted source page.
5. Bibliographic-provider results matched by title, author, publisher, language, date, and format.
6. Work-level or fuzzy searches when stronger evidence is unavailable.

ISBN-10 values are validated and converted to canonical ISBN-13. Invalid check digits never become candidates.

### Ranking and selection

Candidates are deduplicated by canonical ISBN-13 and receive a score plus an evidence breakdown. The target ranking model should include:

- Barcode or manual ISBN match.
- Exact edition provenance.
- Agreement between independent providers.
- Exact and fuzzy title similarity.
- Author/contributor similarity.
- Publisher/imprint similarity.
- Language, publication date, and format compatibility.
- Cover or crop similarity when available.

If at least one candidate exists, rank 1 becomes the algorithmic selection. The remaining candidates are stored in rank order for the owner. Ties must use deterministic rules so rerunning unchanged input produces the same result.

The selection records one of these verification states:

- `algorithm_selected`: current rank-1 answer, not reviewed by the owner.
- `owner_confirmed`: explicitly accepted by the owner.
- `owner_overridden`: the owner selected another candidate or entered an ISBN.
- `unresolved`: no valid candidate exists.
- `no_isbn`: the owner confirmed that the edition has no ISBN.

### Current behavior and remaining gap

The strongest retained candidate is published automatically with the `algorithm_selected` state. Candidate rows retain algorithm version, confidence, score breakdown, provider count, and structured evidence. An owner override changes the copy to `owner_overridden`, records feedback and audit history, and prevents later candidate imports from replacing it. The remaining gap is to populate these same structures from shelfie observations rather than only existing catalogue metadata.

## 3. Extract a cover from ISBN

Status: **implemented for ISBN-based resolution; non-ISBN image extraction is planned**.

### ISBN-first resolution

For a valid ISBN-13, the application exposes one stable URL:

`/api/covers/{isbn13}`

It resolves in this order:

1. Open Library ISBN cover.
2. Google Books ISBN metadata and cover.
3. Existing bundled cover already associated with that ISBN.
4. Generated “cover unavailable” placeholder.

Successful provider responses are validated as images, limited to 8 MB, and cached at the Vercel edge for 30 days. Provider failures use short negative caching. Public browsers request the myLibrary URL rather than contacting providers directly.

### Non-ISBN fallback

When the book is unresolved or confirmed to have no ISBN, use this fallback cascade:

1. Preserve a previously selected local cover.
2. Use a high-quality cover image supplied by the owner.
3. Extract and normalize a front-cover crop from a book photo.
4. Search by strong bibliographic metadata and retain several cover candidates.
5. Use visual similarity between candidates and the shelfie crop.
6. Publish without a cover when no trustworthy image exists.

Non-ISBN cover selection must not invent an ISBN or imply edition-level confidence.

## 4. Manual editing and selection by the owner

Status: **implemented for candidate selection and typed ISBN**.

When the owner browses their public collection, edit controls appear on each book. Visitors see no editing controls.

The owner can:

- Inspect the published ISBN and cover.
- Review all retained edition candidates in rank order.
- Select any candidate as a draft.
- Enter an ISBN-10 or ISBN-13 manually.
- Reject invalid ISBN input before lookup.
- Preview the selected ISBN and cover.
- Publish or discard the draft.

Manual ISBN input is treated as strong owner evidence. It becomes the suggested candidate with explicit `manual ISBN entry` provenance, but still follows the draft-and-publish workflow.

Future owner controls should add:

- Mark “this edition has no ISBN.”
- Upload or crop a cover.
- Choose among multiple cover candidates.
- Edit work-level metadata separately from edition and copy metadata.
- View and restore prior published values.

## Failure and retry behavior

| Failure | Required behavior |
| --- | --- |
| Shelfie is unreadable | Retry transient failures, record a final quality error, delete the image, and request a clearer shelfie. |
| OCR produces weak book data | Keep the detection unresolved and allow manual correction. |
| No valid ISBN candidate | Continue with non-ISBN cover fallback and owner review. |
| Providers disagree | Select rank 1 algorithmically, show confidence/evidence, and retain every alternative. |
| Cover provider is unavailable | Serve a cached result, existing local cover, or placeholder without blocking the catalogue. |
| Owner enters an invalid ISBN | Show a validation error and make no data changes. |
| Owner changes a selection | Create a draft and preserve the published record until confirmation. |

## Observability and cost controls

Track these values per stage and provider:

- Processing duration and retry count.
- Candidate count, selected rank, score, and confidence margin over rank 2.
- ISBN resolution rate and owner correction rate.
- Cover hit, fallback, placeholder, and cache-hit rates.
- Provider requests, failures, throttling, and cost.
- Time from ingestion to owner confirmation and publication.

Reuse cached results by normalized ISBN, provider record ID, and content checksum. Shelfie recognition and bibliographic lookup should run as resumable background jobs with explicit budgets; public catalogue rendering must never wait for ingestion work. Content checksums may be retained for deduplication, but original shelfies and transient crops must be deleted after the initial ingestion and mapping transaction succeeds.

## Next implementation slice

1. Add language, format, fuzzy similarity, and calibrated confidence to ranking.
2. Add “no ISBN” and cover upload/crop owner actions.
3. Add image-quality scoring, optional local spine segmentation, and targeted retries for weak detections.
4. Measure owner override rate by evidence type and algorithm version.
5. Use that feedback to tune ranking without replacing owner decisions.
