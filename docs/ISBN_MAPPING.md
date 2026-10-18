# ISBN matching

Supabase is the single source of truth for books, observations, and edition candidates. There is no static ISBN mapping dataset or file-based catalogue importer.

Automatic ISBN matching during ingestion has been removed. Imports identify books and supply covers; missing covers go directly to cover resolution. Internal ISBN and edition fields remain available for owner refinement.

The owner's Find ISBN candidates action uses Open Library and Google Books on demand and saves review-only results. Manual ISBN entry and candidate selection require owner publication. See [INGESTION_PIPELINE.md](INGESTION_PIPELINE.md) for the current flow.

## Review rules

- Confirm publisher, language, format, and cover against the physical copy.
- Prefer a barcode or copyright-page ISBN over a title match.
- Do not assign an ISBN to books published without one.
- Separate physical copies retain distinct IDs even when they share an ISBN.
- Owner selections and rejections are persisted and respected by automation.
