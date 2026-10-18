# myLibrary ingestion pipeline

`owner's shelfie → external GenAI chat/MCP → book metadata and covers → cover fallback → optional owner ISBN refinement`

## Current stages

1. The assistant identifies physical books, transcribes supported metadata, and searches for a direct public cover image for every book. Exact editions are preferred; representative covers of the same work and volume are allowed. ISBN research and ISBN tool inputs are excluded.
2. The backend imports metadata and supplied covers atomically. Books without covers go directly to cover resolution, without automatic ISBN matching or edition selection.
3. The owner can upload a cover, request ISBN candidates, or enter an ISBN manually. Candidate search saves review-only results; an edition is assigned only when the owner publishes a selection.

Internal ISBN fields, existing edition assignments, and historical evidence remain intact. The legacy import matching columns are compatibility metadata marked completed; ingestion completion depends only on cover state.

## Cover processing

Database insertion events and the hourly Supabase cron job dispatch the same worker. Atomic per-book claims prevent overlapping work. Cover states are `pending → processing → completed | cover_not_found | failed`. Provider failures retry at the next hourly tick; stalled claims recover after ten minutes. Terminal misses do not retry automatically.

Existing selected ISBNs can resolve an ISBN cover. Books without an edition use representative candidate and metadata/web cover discovery. Cover fallback never discovers or assigns a new ISBN edition. Assistant-supplied covers are retained directly.

The import's `ingestion_status` reflects its books' cover states. Matching provider failures cannot block cover processing. Existing covers, owner choices, and internal ISBN data are preserved when automatic matching is retired.

## Owner-requested ISBN search

Find ISBN candidates searches for one copy on demand, independent of ingestion status. It retains ranked review-only candidates without publishing metadata, selecting an edition, or changing cover/ingestion status. The owner explicitly chooses and publishes a result. Rejected candidates remain excluded.

## Owner ISBN drafts and publishing

Manual ISBN entry and candidate selection both perform exact-ISBN metadata lookup against Open Library and Google Books, falling back to cached edition or candidate details. Results are stored privately in the copy draft. The edit page previews that draft's cover, title, author, publisher, language, and publication date before publication. An uploaded owner cover is retained and identified in the preview. Missing provider metadata is explained in the preview; existing book fields are retained where details are unknown. Publishing applies the draft metadata and edition atomically to this physical copy, using a separate work record so other books sharing the original work are unchanged. Saving or discarding a draft never publishes metadata changes.

If the primary ISBN providers have no metadata, owner ISBN lookup also checks web-discovered Book/Product metadata. A result must carry the exact chosen ISBN on that same record, including an explicitly labeled ISBN in its description; unrelated page-wide ISBNs are rejected. Sources are retained with the draft and published metadata. Titles inherited from older manual ISBN entries are not treated as verified ISBN metadata without source evidence.
