# myLibrary

myLibrary is a Next.js catalogue and owner workspace for a physical book collection. Supabase is the single source of truth for collections, books, edition choices, and cover selections. A configured, available database is required to read the catalogue.

## Current initial release

- Public catalogue with search, filters, sorting, ISBN display, and book details.
- Supabase email/password authentication for the owner.
- Ranked edition candidates imported from the existing ISBN analysis.
- Persistent per-book edition drafts.
- Explicit publish and discard actions.
- Atomic catalogue publication with audit history.
- Database-backed public catalogue with explicit errors when data cannot be loaded.

Shelfie extraction uses the owner's existing AI subscription. Owners can paste an AI response or upload JSON, review and edit the books, then import. An optional authenticated MCP connection can list owned collections and books, create and populate a collection, or append generated JSON books to an existing collection. myLibrary never calls a paid model API or receives the shelf photograph. See [connected assistant setup](docs/CONNECTED_ASSISTANT_SETUP.md) for OAuth, the database migration, and plugin distribution. Try the browser-only review at `/shelfies/try`.

## Local development

```sh
npm install
npm run dev
```

Open `http://localhost:3000` after configuring Supabase. Missing configuration or failed catalogue queries show an error; successful empty queries show an empty catalogue. No file-based catalogue or reference dataset is used.

Copy `.env.example` to `.env.local` after creating Supabase:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

The service-role key is only for trusted server-side pipeline tooling. Never expose it in browser code.

## Validation

```sh
npm run typecheck
npm run build
npm run test
```

See [Deployment](docs/DEPLOYMENT.md) for Supabase setup and Vercel publication.

## Data and pipeline tools

- `supabase/migrations/` contains the persistent schema and database functions.
- `lib/manual-genai-import.ts` contains the Stage 1 prompt and JSON validator.
- `docs/STAGE_1_MANUAL_GENAI_IMPORT.md` specifies the manual GenAI ingestion contract.
- `npm run pipeline:process` processes unresolved imports from Supabase.
- `npm run match:import`, `npm run covers:candidates`, and `npm run covers:metadata` run individual database-backed stages.

Assistant-supplied ISBNs and covers are retained in the database. When no cover is supplied, external ISBN and cover providers remain available. Deleted collections are not reconstructed from local files. Existing static cover images remain available only for database records that explicitly reference them; they are not searched as a catalogue.
