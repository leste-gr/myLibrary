# ISBN matching

Supabase is the single source of truth for books, observations, and edition candidates. There is no static ISBN mapping dataset or file-based catalogue importer.

The backend matches unresolved imported books against Open Library and Google Books. Candidates, evidence, confidence, and owner decisions are stored in Supabase. Assistant-supplied ISBN and cover results are accepted by the ingestion flow; backend discovery runs when no cover is supplied.

Run `npm run match:import -- <id>` as a development tool for one import. Production processing is dispatched by the database insertion event. See [COVER_RESOLUTION.md](COVER_RESOLUTION.md) for provider ranking and cover resolution.

## Review rules

- Confirm publisher, language, format, and cover against the physical copy.
- Prefer a barcode or copyright-page ISBN over a title match.
- Do not assign an ISBN to books published without one.
- Separate physical copies retain distinct IDs even when they share an ISBN.
- Owner selections and rejections are persisted and respected by automation.
