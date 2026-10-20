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
