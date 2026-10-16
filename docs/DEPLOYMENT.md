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
8. A valid visible ISBN creates an edition candidate and its `/api/covers/{isbn}` URL resolves.

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
