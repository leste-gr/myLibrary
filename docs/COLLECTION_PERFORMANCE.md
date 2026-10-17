# Collection loading performance

The directory and collection pages cache only anonymous public-view results for 30 seconds. Cache keys include the dataset URL and collection slug. Account identity and collection ownership checks are request-scoped and are never shared between users. Existing owner actions use revalidatePath to invalidate changed pages immediately; external database updates are picked up by the short cache revalidation window.

Opening a collection queries that slug directly instead of fetching the complete directory. Metadata, book contents, and viewer permissions load concurrently. The account menu and catalogue share one authentication lookup within a request. The directory and account menu stream independently; collection navigation includes a loading boundary so the browser can prefetch its shell.

The catalogue selects and serializes only the fields its cards, filters, search, and detail dialog use. It retains the complete book list for searching and filtering. Search text is indexed once for a loaded collection, and deferred filtering keeps typing responsive.

No pipeline actions, workers, provider lookups, scheduler settings, or database migrations are changed by this optimization.

Validation:

- npm run build
- npm test
- npm run test:catalogue-cache (requires the production build and free local port 3108)

The cache check starts isolated local Supabase-shaped endpoints and a local production Next server. It verifies warm reads avoid database requests, collection cache entries stay separate, owner controls are not shared with other users or anonymous visitors, My collections remains scoped to the current owner, and existing delete-action revalidation removes cached directory and collection entries immediately. It never mutates production data.

Production baseline on 2026-10-17, from this workstation, before deployment: after the first request, the directory response completed in 326–558 ms, and a 165-book collection completed in 458–651 ms. The collection HTML plus serialized data was 117,711 bytes. These are HTTP response measurements; they do not include browser hydration or downloading cover images.
