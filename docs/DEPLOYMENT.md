# Initial release deployment

This release uses GitHub for source control, Vercel for the Next.js application, and Supabase for authentication and persistent catalogue data. Railway is intentionally deferred until shelfie processing begins.

## 1. Create the Supabase project

Create one Supabase project in the region nearest the primary owner. Record:

- Project URL.
- Publishable/anonymous key.
- Service-role key.

Keep the service-role key private. It bypasses row-level security and is only needed for the one-time importer.

In **Authentication → Providers**, enable email/password. Disable public sign-ups after creating or inviting the single owner account. The initial schema treats every authenticated account as an owner, so the project must remain invite-only.

## 2. Apply the database migration

Apply `supabase/migrations/202610060001_initial_schema.sql` with the Supabase SQL editor or CLI.

The migration creates:

- Works, editions, physical copies, and edition candidates.
- Per-copy draft selections.
- Audit events.
- Row-level security for public and authenticated access.
- `public_catalogue`, the read model used by the website.
- `publish_copy_draft`, the atomic publish transaction.

## 3. Import the existing catalogue

Create `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Then run:

```sh
npm run import:catalogue
```

Expected import totals for the current dataset:

```json
{"works":166,"editions":28,"copies":166,"candidates":1007}
```

The importer is idempotent for works, editions, copies, and candidates. It preserves every `Bxxx` identifier and does not create owner accounts.

## 4. Verify locally

Run:

```sh
npm run dev
```

Verify:

1. The public catalogue contains 166 books.
2. `/login` accepts the invited owner.
3. `/admin` lists all physical copies and candidate counts.
4. Selecting an edition creates a draft without changing the public page.
5. Publishing the draft updates the public ISBN and cover.
6. An entry appears in `audit_events`.
7. Discarding a draft leaves the public catalogue unchanged.

The public page is cached for up to 60 seconds. Server actions explicitly invalidate it after publication.

## 5. Deploy to Vercel

Import `leste-gr/myLibrary` in Vercel and select the Next.js framework preset. Add these production environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Do not add `SUPABASE_SERVICE_ROLE_KEY` to Vercel for this release. Trigger the first deployment, verify the generated Vercel domain, and test login and publication again.

Pull requests receive preview deployments. The `main` branch deploys production.

## 6. Move the domain

After validation, point the desired domain to Vercel using the records Vercel provides. Remove or disable the previous GitHub Pages custom-domain configuration only after the Vercel domain works over HTTPS.

GitHub Pages can remain available at its repository URL during the transition, but it is no longer the production application.

## Security checklist

- Public sign-up is disabled in Supabase.
- Only the owner account exists in Supabase Auth.
- Row-level security is enabled on every application table.
- The service-role key exists only in secure local/import environments.
- Shelf photos are not part of this release.
- Database backups and point-in-time recovery are configured according to the chosen Supabase plan.
