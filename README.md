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

Shelfie extraction uses the owner's existing AI subscription. Owners can paste an AI response or upload JSON, review and edit the books, then import. An optional authenticated MCP connection lets a chat send private drafts directly for owner review. myLibrary never calls a paid model API or receives the shelf photograph. See [connected assistant setup](docs/CONNECTED_ASSISTANT_SETUP.md) for OAuth, the database migration, and plugin distribution. Try the browser-only review at `/shelfies/try`.

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
npm run test
```

See [Deployment](docs/DEPLOYMENT.md) for Supabase setup, catalogue import, and Vercel publication.

## Data and migration tools

- `books.json` contains the 166 original copy records.
- `isbn.json` contains accepted ISBN-13 mappings.
- `data/isbn-mapping.json` contains ranked edition candidates.
- `scripts/import-catalogue.mjs` imports the catalogue into Supabase.
- `scripts/map_isbns.py` regenerates ISBN candidates.
- `supabase/migrations/` contains the persistent schema and publish transaction.
- `lib/manual-genai-import.ts` contains the versioned Stage 1 prompt and JSON validator.
- `docs/STAGE_1_MANUAL_GENAI_IMPORT.md` specifies the manual GenAI ingestion contract.
- `public/covers/` contains local cover assets.

The stable `Bxxx` identifiers remain the IDs shown to users and used during migration.
