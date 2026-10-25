# Deployment

myLibrary uses GitHub for source control, Vercel for the Next.js application, and Supabase for authentication and persistent catalogue data. Stage 1 has no hosted worker and requires no OpenAI, Roboflow, Railway, or model-provider API key.

## 1. Configure Supabase

Create a Supabase project and record its project URL, publishable/anonymous key, and service-role key. Enable email/password authentication. Keep the service-role key private: it bypasses row-level security and is needed only by trusted migration/import tooling.

Apply every SQL file in `supabase/migrations/` in filename order using the Supabase CLI or SQL editor. For the manual GenAI flow, `202610100009_manual_genai_import.sql` adds:

- import provenance and duplicate-payload protection;
- the `manual_genai_json` observation source;
- the authenticated, atomic `import_manual_genai_books` function; and
- ownership policies for import records.

`202610110010_manual_genai_matching_status.sql` introduced persistent Stage 2 progress. Migration `202610160030_remove_scheduled_and_owner_retries.sql` removes the scheduled and owner-operated retry paths and terminalizes their remaining queue state.

Apply `202610160031_stage3_cover_resolution.sql` before deploying the Stage 3 cover refactor. It keeps Stage 2 edition selection separate from cover assignment and adds the service-role-only `attach_resolved_isbn_covers` RPC used by Stage 3. Existing cover selections remain intact.

Apply `202610170032_hourly_ingestion_recovery.sql` for hourly recovery. It adds per-book cover state, whole-import completion, atomic work claims, and the `mylibrary-hourly-ingestion-retry` pg_cron job (`0 * * * *`). Verify the job is active in `cron.job`. Deploy the updated `pipeline-dispatch` Edge Function with its existing JWT verification setting (`false`): it acknowledges the database HTTP call immediately and runs the worker with `EdgeRuntime.waitUntil`. Deploy the matching application code before testing the scheduler. Check `cron.job_run_details` for scheduler execution and Edge Function logs for worker results; a cron dispatch alone does not prove worker completion.

Apply `202610170033_default_missing_cover.sql` with the shared `/covers/cover-not-found.svg` asset. Terminal cover misses display this placeholder in the public catalogue and owner editor while retaining a null stored cover URL, so the placeholder cannot reopen retries or count as a successfully found cover.

`202610170034_universal_cover_fallback.sql` extends the default image to every empty cover, including pending ingestions. The shared `BookCoverImage` component also catches failed image loads and decode failures in cards, dialogs and owner edition views, including failures that occur before hydration. Existing confirmed-broken cover URLs can be retained for inspection while setting `cover_status = 'cover_not_found'` to display the default.

Apply `202610170035_owner_cover_uploads.sql` before deploying owner cover uploads. It creates the private `book-covers` bucket, owner write policies, public-book/owner read policies and the owned-cover selection RPC. The application uses the signed-in user's session, not a service-role key, to upload and serve images. Cover files are limited to 4 MB; the server-action multipart request limit is 5 MB. The `sharp` dependency validates and normalizes uploads on the server.

Never expose `SUPABASE_SERVICE_ROLE_KEY` in a browser bundle.

## 2. Configure the application

Create `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then run `npm install`. Supabase is required for catalogue reads; there is no bundled catalogue or seed import. Create collections through the application or connected assistant.

Use `SUPABASE_SERVICE_ROLE_KEY` only in trusted server-side pipeline tooling. Never expose it to the browser.

## 3. Verify locally

```sh
npm run test
npm run typecheck
npm run build
npm run dev
```

Verify that:

1. Public collection pages are readable while signed out.
2. An invited owner can sign in and edit their collection on its public page.
3. **Import shelfie** displays the external-chat prompt and does not request an image upload.
4. A conforming `mylibrary.shelfie.v1` JSON file imports into an existing collection.
5. The same JSON cannot be imported into that collection twice.
6. Invalid JSON creates no partial records.
7. A JSON file can create a named collection with an optional description.
8. Imports do not create ISBN candidates; owner ISBN search, manual entry, draft preview, and publication remain available.

The public page may be cached for up to 60 seconds. Mutations explicitly refresh application data where required.

## 4. Deploy to Vercel

Import `leste-gr/myLibrary` in Vercel and select the Next.js preset. Add only these browser-safe production variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Do not add the service-role key for the manual GenAI import. The signed-in browser invokes a narrowly scoped database function, which verifies collection ownership itself.

Pushes to `main` deploy production; feature branches and pull requests receive preview deployments when enabled. Apply the matching database migration before testing a preview that uses new schema.

## Stage 1 privacy boundary

The owner uploads the shelf photograph directly to a GenAI chat they choose. myLibrary only receives the downloaded JSON response. Consequently:

- there is no image storage bucket or cleanup worker in the Stage 1 flow;
- Vercel and Supabase do not receive the shelf photograph;
- the external chat provider's privacy, retention, and usage terms apply; and
- myLibrary stores the structured observation payload, its checksum, and import provenance.

## Security checklist

- Supabase row-level security is enabled and tested for every application table.
- The database import function checks `auth.uid()` and target collection ownership.
- Public sign-up follows the intended product policy; owner accounts are controlled.
- Service-role credentials exist only in trusted tooling environments.
- JSON size, count, types, ISBN checksums, and key field limits are validated.
- Database backups and recovery are configured according to the Supabase plan.

Owner ISBN search: apply migration 202610170036_owner_isbn_candidate_search.sql before deploying the edit-page changes. It adds review-only candidate persistence and per-copy search metadata, and prevents candidate-only searches from invoking automatic ISBN assignment. No Edge Function redeployment is required.

ISBN draft preview: apply migration 202610170037_isbn_draft_metadata.sql before deploying. It adds private draft metadata, an owner-only browser draft RPC, and atomic publication of title, authors, publisher, language, publication date, and chosen cover. The existing browser-only publish wrapper remains in place. No Edge Function changes are needed.

Cover-only ingestion: apply `202610180038_cover_only_ingestion.sql` before deploying the application. It removes automatic candidate selection, replaces import-time ISBN handling with cover-only imports, releases existing failed matching queues, and makes cover claims/completion independent of matching. Internal ISBN fields and owner ISBN workflows remain. The old matching claim RPC becomes a no-op for rollout compatibility. No Edge Function change is required. MCP clients should reconnect to refresh version 1.5.0 instructions and schemas.

MCP 1.6.0 puts the cover-search prerequisite first in initialization instructions, write-tool descriptions, and the shared extraction protocol. `coverUrl` is now required (nullable); missing covers without notes are rejected before any write callback. The server cannot verify whether a client actually searched. The named prompt no longer requests a second import confirmation after the user has already authorized it. Reconnect clients to refresh cached tool schemas. No database migration is required.

MCP 1.7.0 replaces the shared extraction instructions with the supplied five-phase mandatory cover-search and completion gate. The website prompt keeps its opening role text and JSON specification unchanged. The same instructions are exposed through MCP initialization, import tools, and the named prompt. No database changes are required.

ISBN camera entry: apply `202610200039_add_owned_isbn_book.sql` before deploying. It adds the browser-owner-only atomic book-creation RPC and a unique request ID for safe retries. The collection row serializes scans; an existing ISBN in that collection returns the existing book. Scans never enter automatic shelf-photo matching. Internal ISBN and owner edition workflows are unchanged.

Owners open a collection, choose **+ Add by ISBN**, allow the rear camera, scan the ISBN/EAN-13 barcode, review/edit the retrieved metadata, and confirm **Add to collection**. Manual ISBN-10/13 entry works when the camera is unavailable or denied. Camera frames remain on the device, and tracks are stopped after detection, cancellation, backgrounding, and navigation. The `@zxing/browser` decoder is loaded only when scanning starts and does not require the native BarcodeDetector API. Camera access requires HTTPS (or localhost) and browser permission.

Validation includes the real migrations and ownership/idempotency tests, camera lifecycle tests, Greek translations, and an isolated Chromium mobile-viewport check using a generated ISBN barcode as a fake camera stream and mocked metadata/database services. This does not substitute for a physical iOS/Android camera check.

Reading status: apply `202610200040_book_reading_status.sql` before deploying. It adds per-copy `unread` (default), `read`, and `radar` status, appends it to the public catalogue view, and exposes an owner-only browser RPC. The catalogue shows **Unread**, **Read**, and **On my radar**, with inline selectors for owners and badges for visitors. Failed saves restore the previous selection. The new public cache key avoids retaining payloads without the new field.

Bulk reading status and radar: apply `202610200041_bulk_reading_status.sql` before deploying. It adds an atomic browser-owner-only batch RPC (1–1,000 distinct books in one collection). Invalid or foreign IDs reject the whole batch. Owners select individual cards or all displayed books, then apply a status. Changing filters clears the selection. The collection reading-status filter combines with existing search/filters and updates immediately after saves.

`/radar`, linked from the signed-in account menu, fetches only the current owner's published radar copies, including private collections, with explicit pagination. It uses session-scoped reads without shared caching. Single and bulk status changes invalidate both the collection and radar paths. Changing a radar card to Read or Unread removes it from the radar list after a successful save.

MCP 1.8.0 uses `lib/shelfie-mcp-instructions.ts` for initialization, import-tool descriptions and the named shelf-photo prompt. It imports directly through tools, without requiring a downloadable file or file-generation capability. Larger inventories use reviewed batches of up to 100 books (create once, then append). Unavailable web search requires a specific capability/authorization question, rather than a status-only final response; coverless imports require honest blocker notes and explicit user authorization. Existing cover validation remains in place. The website's exact copy-paste prompt is unchanged. No database migration is required. Reconnect clients and use a fresh import chat to remove cached v1.7.0 workflow instructions.

MCP 1.8.1 removes the entire “IF THE CLIENT CANNOT SEARCH” section from MCP initialization, import-tool descriptions, and the named prompt. Cover searching, batch imports, and existing validation remain. The website prompt is unchanged. No database migration is required.

Reading-status saves use the same-origin JSON route `/api/reading-status`. Single and bulk updates keep their existing session checks and owner-only database RPCs. Cache invalidation now runs in the Route Handler, so the response does not wait for the collection or radar to render again. The client updates its books after acknowledgement; a later page visit reloads invalidated public data. No database migration is required. Run `npm run test:reading-status` after building to verify saves finish without catalogue reads, next-visit cache freshness, access checks, and write failures.

MCP 1.9.0 adds `update_covers` for server-side discovery, image verification and
conditional saving of missing covers. Apply `202610220042_assistant_update_covers.sql`
before deploying the application. It adds two ownership/connection-checked RPCs;
anonymous execution is revoked. It does not modify existing books during migration.
The MCP route allows up to 300 seconds, with bounded per-book search and database
requests and batches of 1–5 books. Server initialization and the tool description
instruct clients to follow `nextCursor` until `hasMore` is false. Existing covers,
owner uploads, ISBNs, reading statuses and the website copy-paste prompt are preserved.

Mobile catalogue polish: the book dialog reserves a sticky row for its 44px close
button, uses the dynamic viewport height and contains overscroll. Collection-region
focus no longer draws a browser-default outline; keyboard focus indicators remain
on interactive controls. Touch devices do not retain the card hover lift, and
selection checkboxes keep their size beside wrapping labels. Verified in Chromium
at 320, 390, 768 and 1280px widths, including Greek labels, dialog scrolling,
keyboard/Escape focus restoration and editor/browser-back navigation to a book
beyond the first loaded batch. No database migration is required.

Collection multi-selection now uses a Select books / Done selecting control beside
Select displayed books. In selection mode, book-card buttons toggle selection and
expose their pressed state, with a cover outline and checkmark instead of individual
checkboxes. Selecting all enables the mode; exiting clears the selection. Successful
bulk saves exit the mode, while failed saves retain the selected books for retry.
Verified mobile/desktop tap and keyboard behavior, visitor browsing, filters, bulk
save success/failure and English/Greek labels. No database migration is required.

Book loans: apply `202610250043_book_loans.sql` before deploying. Loan status and
optional borrower/lender names live in an owner-only `book_loans` table, outside
public views and shared catalogue caches. Browser owners save through the scoped
`set_owned_book_loan` RPC and same-origin JSON `/api/book-loan` route; other owners,
visitors and OAuth clients cannot read or modify loan records. Each physical copy
has one current loan: Loaned out, Loaned in, or Not on loan (deletes the record).
The owner edits loan details inline below reading status on collection cards.
Names are optional, trimmed and limited to 120 characters. Reading progress,
ISBNs, covers and other book metadata are unaffected. Deleting a book or collection
cascades its loan records. Run `npm run test:book-loans` after a build with Supabase
variables unset to verify persistence, private HTML/RSC, CSRF and failure behavior
against an isolated fixture. The real-migration tests exercise RLS and RPC grants.

Loan controls now live exclusively on the owner book edit page. Collection cards
render a read-only badge and contact only for active Loaned out / Loaned in records;
books without loans render no loan section. The editor reads the existing private
loan through its ownership-scoped copy query, and successful saves refresh the
editor and invalidate both edit and collection paths. Existing loan data and
privacy rules are retained; no migration is required. Verified editor/loan
integration, English/Greek translations, and phone/desktop save-and-return flows.

Collection owners can filter by All loan statuses, Loaned out, Loaned in and Not on
loan. The filter combines with search and reading status, appears in active chips
and filter counts, clears bulk selection when changed, and is restored on editor
return. Loan filters use the existing session-scoped private data and are hidden
from visitors. Verified English/Greek phone and desktop flows; no migration required.

Multiple category tags: apply `202610250044_category_tags.sql` before the application.
`copies.categories` is the canonical ordered array (up to 8 tags of 80 characters);
`category` remains a compatibility alias for its first tag. Legacy meaningful
categories are retained. The public view and MCP book list expose the array. Import
observations persist supplied tags in the same transaction, and later cover-only
observation updates preserve subsequently edited tags. MCP 1.10.0 requires clients
to provide 1–8 supported English category tags per ingested book. Manual JSON keeps
older payloads valid and preserves their checksum shape when tags are absent.
The website prompt, review and category filter use the array; a book matches any
one of its tags, and detail/edit pages show all tags. No ISBN/cover workflow changes.

The one-time current-library backfill is reviewed from saved title/author/series/
format metadata. `scripts/backfill-category-tags.py --project REF --plan PLAN.json`
is a dry run. `--apply` checks every copy against the reviewed snapshot, writes an
exclusive rollback snapshot, applies all tags in one serializable transaction and
records per-book evidence in audit events. It aborts if the inventory changed, any
stored tag differs from the plan, or any non-category book field changes. Catalogue
contents and reviewed plans are local operational artifacts, not committed data.
