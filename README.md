# myLibrary

myLibrary is a Next.js catalogue and owner workspace for a physical book collection. The public catalogue remains readable without a backend during migration; when Supabase is configured, edition choices are stored as drafts and published persistently.

## Current initial release

- Public catalogue with search, filters, sorting, ISBN display, and book details.
- Supabase email/password authentication for the owner.
- Ranked edition candidates imported from the existing ISBN analysis.
- Persistent per-book edition drafts.
- Explicit publish and discard actions.
- Atomic catalogue publication with audit history.
- Bundled fallback data for local development and deployment previews.

Shelfie imports use the owner's ChatGPT account. myLibrary creates a short-lived, single-use import code and accepts only structured book JSON; the shelfie image is never uploaded to or stored by myLibrary. A copy/paste journey is available immediately, and the same endpoint exposes an OpenAPI schema for a Custom GPT Action.

## Local development

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. Without Supabase variables, the public catalogue uses the bundled `books.json` and `isbn.json`; the owner workspace shows setup guidance.

Copy `.env.example` to `.env.local` after creating Supabase:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

The service-role key is only for the local importer. Never expose it in browser code or add it to Vercel unless a future server-only operation explicitly needs it.

## Validation

```sh
npm run typecheck
npm run build
npm run import:dry-run
```

See [Deployment](docs/DEPLOYMENT.md) for Supabase setup, catalogue import, and Vercel publication.

## Data and migration tools

- `books.json` contains the 166 original copy records.
- `isbn.json` contains accepted ISBN-13 mappings.
- `data/isbn-mapping.json` contains ranked edition candidates.
- `scripts/import-catalogue.mjs` imports the catalogue into Supabase.
- `scripts/map_isbns.py` regenerates ISBN candidates.
- `supabase/migrations/` contains the persistent schema and publish transaction.
- `public/covers/` contains local cover assets.

The stable `Bxxx` identifiers remain the IDs shown to users and used during migration.
