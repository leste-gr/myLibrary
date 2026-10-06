# ISBN mapping process

This project treats the ISBN-13 as the identifier of a specific cover edition. `Bxxx` remains the identifier of the owned physical copy.

The mapper writes review data to `data/isbn-mapping.json`; it never changes `books.json`. This prevents a plausible title match from silently becoming the edition of record.

Each record distinguishes `isbn13`, which is accepted, from `suggestedIsbn13`, which still requires inspection. Candidate lists are ranked and capped at ten entries so the review workload stays usable.

## Current baseline run

The 6 October 2026 batch processed all 166 catalogue records:

- 28 ISBNs accepted from exact edition provenance or structured source metadata.
- 93 additional ISBNs suggested from a unique match to the currently selected cover; these require physical-edition review.
- 25 records have ranked candidates but no single cover-linked suggestion.
- 20 records remain unresolved.
- 1,007 ranked candidates are retained, with at most ten per copy and no lookup failures.

Google Books was excluded from this baseline because the environment's shared API consumer had zero daily query quota. Open Library and the existing source pages completed successfully.

## Mapping evidence

The process uses evidence in this order:

1. An existing edition-level source that contains exactly one valid ISBN.
2. An existing source page that exposes exactly one valid ISBN in structured metadata.
3. An Open Library edition whose cover ID equals the already selected cover, used to rank candidates but not accepted by itself.
4. Title, author, publisher, language, and cover candidates for manual review.
5. A barcode, copyright-page photo, or manual ISBN entry when metadata is still ambiguous.

Only the first two forms can be accepted automatically, and only when they resolve to one ISBN-13. A cover match alone does not prove that the physical book is that edition because some current covers are known to differ. All ISBN-10 values are validated and converted to ISBN-13. Every other result stays in `needs_review` or `unresolved`.

## Commands

Initialize all 166 records without making network requests:

```sh
python scripts/map_isbns.py --init-only
```

Run a small lookup sample:

```sh
python scripts/map_isbns.py --copy-id B001 --copy-id B059
```

Run the complete mapping batch:

```sh
python scripts/map_isbns.py
```

Google Books is optional because unauthenticated shared quota may be unavailable. Enable it only when usable quota exists:

```sh
python scripts/map_isbns.py --google-books
```

The complete run needs read-only HTTPS access to `openlibrary.org`, `bibliography.gr`, `www.googleapis.com`, `antipodes.gr`, and `www.fantasticfiction.com`. Lookups should respect provider terms and rate limits.

## Review rules

- Confirm that the publisher, language, format, and visible cover match the physical copy.
- Prefer a barcode or copyright-page ISBN over an inferred title match.
- Do not assign an ISBN to books published without one.
- Intentional duplicate physical copies retain distinct `Bxxx` IDs even when they share an ISBN.
- If several ISBNs share the same selected cover, inspect the physical copy rather than choosing one arbitrarily.
