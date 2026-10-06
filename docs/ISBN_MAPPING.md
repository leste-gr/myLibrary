# ISBN mapping process

This project treats the ISBN-13 as the identifier of a specific cover edition. `Bxxx` remains the identifier of the owned physical copy.

The mapper writes review data to `data/isbn-mapping.json`; it never changes `books.json`. Ranked results are imported into Supabase, where rank 1 becomes the edition of record unless the owner has already overridden the algorithm.

Each record stores the automatically selected `isbn13` and all retained alternatives. Candidate lists are ranked and capped at ten entries so optional owner review stays usable. Owner choices are stored in Supabase audit and feedback records rather than being overwritten by later mapper runs.

## Current baseline run

The 6 October 2026 batch processed all 166 catalogue records:

- 146 ISBNs selected automatically from rank 1.
- 20 records remain unresolved.
- 1,007 ranked candidates are retained, with at most ten per copy and no lookup failures.
- The production catalogue currently preserves 2 owner overrides and has 144 algorithm-selected copies.

Google Books was excluded from this baseline because the environment's shared API consumer had zero daily query quota. Open Library and the existing source pages completed successfully.

## Mapping evidence

The process uses evidence in this order:

1. An existing edition-level source that contains exactly one valid ISBN.
2. An existing source page that exposes exactly one valid ISBN in structured metadata.
3. An Open Library edition whose cover ID equals the already selected cover, used to rank candidates but not accepted by itself.
4. Title, author, publisher, language, and cover candidates for manual review.
5. A barcode, copyright-page photo, or manual ISBN entry when metadata is still ambiguous.

All ISBN-10 values are validated and converted to ISBN-13. When candidates exist, rank 1 is selected automatically and labelled `algorithm_selected`; a cover match alone receives less weight than edition-level provenance. The owner may optionally replace the selection, after which the copy is labelled `owner_overridden` and protected from subsequent automatic changes.

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

Re-rank the stored candidates without making provider requests:

```sh
python scripts/map_isbns.py --rerank-only
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
