# Connected shelfie import — setup and rollout

The branch implements a ChatGPT-compatible MCP server, Supabase OAuth consent,
backend-owned collection imports, and the provider-neutral paste/file fallback.
The backend never calls an AI model. Users upload photographs to their own chat.
Vercel/Supabase hosting and users' existing subscription limits still apply.

## What is available immediately

- `/shelfies/try`: public, browser-only paste/file review demo; writes nothing.
- `/shelfies`: signed-in paste/file review and import through the existing importer.
- `/shelfies/connect`: connection instructions and honest availability status.
- `/api/mcp`: disabled with HTTP 503 until the setup below is complete.

The fallback works with migration 009. Connected drafts require migration 010.
The app does not show an install button unless a real plugin install URL is set.

## 1. Choose the deployment and database

Use a separate Supabase development project for this branch preview if possible.
Use the verified Vercel preview URL (or a stable custom domain) as `SITE_ORIGIN`.
OAuth and review links must use that same origin. A production integration should
use the permanent production domain, not a deployment URL that changes each build.

If using the existing production Supabase project, note that its Auth Site URL is
project-wide. Do not point production auth at a disposable preview. Either use a
separate project or wait to enable OAuth until this branch is promoted to production.

## 2. Apply the database migrations

Apply migrations in filename order through
`202610150029_self_service_assistant_oauth.sql`. Existing installations must apply
only unapplied migrations. Historical migrations are not idempotent.

Migration 029 onboards a Supabase-registered OAuth client when the signed-in user
approves a valid pending authorization. It verifies the request owner, expiry,
PKCE S256, scopes, resource, and administrator disablement. Consent is recorded
per user; it does not grant access to another user's library.

The migration copies the canonical MCP resource from existing client registrations
when they all use the same endpoint. For a new or multi-resource installation,
configure it once using trusted database administration:

```sql
insert into private.assistant_oauth_settings(singleton, resource_url)
values (true, 'https://YOUR_SITE_ORIGIN/api/mcp')
on conflict(singleton) do update set resource_url = excluded.resource_url;
```

Keep the `private` schema outside the Data API. Ordinary browser and plugin
sessions cannot edit this setting or enable an administrator-disabled client.

## 3. Configure Google sign-in and the Supabase OAuth server

Supabase provides both the database and authentication. There are two OAuth roles:
Google identifies the person signing into myLibrary; Supabase issues the plugin's
own OAuth tokens after that person approves access.

### Google registration and login (one-time application setup)

1. In Google Cloud, configure the OAuth consent screen and create an OAuth client
   of type **Web application**. For public registration, use an External audience
   and publish the consent configuration when ready. While testing, add the
   accounts that should be allowed as test users.
2. Set the authorized redirect URI to
   `https://PROJECT.supabase.co/auth/v1/callback`. This is Google's callback to
   Supabase, not the application's `/auth/callback` route.
3. In Supabase → Authentication → Sign In / Providers → Google, enter the Google
   client ID and client secret and enable Google. Keep the secret in Supabase;
   never put it in the application repository or MCP/plugin configuration.
4. Allow new user sign-ups. Supabase creates the user on their first Google login;
   existing verified identities follow Supabase's account-linking rules.
5. Set Supabase Auth Site URL to `SITE_ORIGIN` and include
   `SITE_ORIGIN/auth/callback` in its redirect allowlist. For development, explicitly
   add `http://localhost:3000/auth/callback` to the development project's allowlist.
6. Set `MYLIBRARY_SITE_URL` to the same origin. The application creates a PKCE
   flow, exchanges the returning code for the browser session, and preserves a
   pending `/oauth/consent?authorization_id=...` request through Google login.

The same **Continue with Google** button registers a new user or signs an existing
user in. Website logout ends the current browser session. Plugin grants are
managed separately at `/shelfies/connections`.

### Endpoint-only MCP connection

1. Use an asymmetric Supabase signing key (ES256 or RS256).
2. Enable Supabase OAuth Server, set Authorization Path to `/oauth/consent`, and
   enable **Dynamic Client Registration**. The MCP client must support OAuth
   discovery and dynamic registration to connect using only the endpoint.
3. Configure the Custom Access Token Hook to use
   `public.assistant_access_token_hook`. If an existing hook serves another
   integration, merge its claims behavior rather than replacing it blindly.
4. Keep scopes to `openid email offline_access`. Require authorization-code flow
   with PKCE S256. Supabase validates registered redirect URIs, codes and refresh
   tokens. The consent page validates the pending request before enabling the
   client and recording this user's grant.

Users provide only `SITE_ORIGIN/api/mcp` and select OAuth in their MCP client.
They sign in with Google and approve the named client. Neither the website nor
the plugin contains a personal token or a fixed user identity. Each issued token
identifies its own user and client; the backend verifies its signature, expiry,
issuer, audience, user identity, and live per-user grant.

Dynamic registration creates an OAuth application record, not permission to read
any library. The user must still approve access. Administrators can disable a
client in `assistant_oauth_clients`; users can revoke their own grants at any time.
Clients without discovery/dynamic registration support require manual client
configuration and cannot offer the endpoint-only experience.

Authorization endpoint: `https://PROJECT.supabase.co/auth/v1/oauth/authorize`

Token endpoint: `https://PROJECT.supabase.co/auth/v1/oauth/token`

Discovery: `https://PROJECT.supabase.co/.well-known/oauth-authorization-server/auth/v1`

Protected-resource discovery is served at both
`SITE_ORIGIN/.well-known/oauth-protected-resource` and its `/api/mcp` suffix variant.

## 4. Set Vercel environment variables for the chosen branch/environment

```text
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
MYLIBRARY_SITE_URL=https://YOUR_SITE_ORIGIN
MYLIBRARY_MCP_ENABLED=true
```

Do not set a service-role key or an OpenAI API key. Redeploy after changing variables.
Keep `MYLIBRARY_MCP_ENABLED=false` until migrations, dynamic registration, and the hook are
ready. On each deployment, use a resource URL matching its configured site origin.

## 5. Connect and test in ChatGPT

In an account that supports custom MCP connections, add `SITE_ORIGIN/api/mcp` with
OAuth. Leave manual client credentials empty when the client supports discovery
and dynamic registration. Continue with Google and approve the named application
on the consent screen.

The connected server exposes `list_collections`, `list_collection_books`,
`create_collection`, `update_collection`, and `update_covers`. Collection creation and imports
require an explicit user request. `create_collection` receives the name and complete
book JSON atomically; `update_collection` adds only books not already present in
the owned collection. Existing-book identity uses ISBN when supplied, otherwise
normalized title, authors, and volume. The result reports `ignoredExisting`.

Test with a small shelf photo or a JSON attachment:

1. Ask to list your collections, then choose one.
2. Ask to list the books in that collection. For a new destination, explicitly
   ask it to create a collection with a name and optional description.
3. Ask it to construct the JSON and create or update the selected collection.
4. Open the returned collection link and verify the imported books.
5. Repeat the same tool payload: no duplicate books or collection should be created.
6. Visit `/shelfies/connections` and revoke access. Further tool calls must fail,
   including with a previously issued access token. Reconnect through consent.

The user's signed-in account owns every collection and import it creates; collection IDs never grant access.
Prompt injection in titles/notes cannot grant additional tools or SQL privileges.
The browser fallback review UI renders book fields as text, never HTML.

## 6. Package and distribute

```sh
node scripts/package-assistant.mjs https://YOUR_SITE_ORIGIN
```

This writes a portable `plugin.json` and `mcp.json` to
`artifacts/mylibrary-assistant/`. The MCP server supplies tool instructions plus the
`read_shelf_photo` prompt; no model/API credentials are bundled.

For ChatGPT distribution, register the remote MCP endpoint and test it in your
account. Public plugin directory submission/review is separate from publishing
the Vercel site and cannot be completed by a Git push. Once a real install/share
link exists, optionally set `MYLIBRARY_ASSISTANT_INSTALL_URL` to that HTTPS ChatGPT
URL and redeploy to show the install button.

## Validation completed in the repository

`npm test` runs parser, JWT, MCP protocol and real PostgreSQL migration tests
(PGlite with pgcrypto). Hosted auth/storage scaffolding is simulated, but all app
migrations, RLS, transaction rollback, deduplication, cross-owner rejection and
revocation execute in PostgreSQL. This does not replace testing the hosted OAuth
redirect/token flow after configuration.

`npm run build` verifies production compilation and route generation.

## References

- [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth)
- [Plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [Supabase OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
- [Supabase token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)

## Release verification for Google + self-service OAuth

- New Google account: sign-in creates its own user and collection.
- Existing Google account: returns to its own library without creating duplicates.
- Cancelled/expired Google login: shows an error and preserves any pending consent destination.
- Website logout: removes the session and shows Sign in / Register across the site.
- A second user's plugin connection cannot read or modify the first user's collections.
- A newly registered MCP client reaches consent without an administrator adding its ID.
- Denial grants no access; revocation stops subsequent calls with old access tokens.
- Expired requests, wrong resources, broad scopes, non-S256 PKCE, and disabled clients fail closed.

Database integration tests exercise application migrations against simulated hosted
OAuth tables. A final Google account round trip and client registration/token
exchange must also be checked against the configured hosted providers.

## Email/password accounts

Users can select **Register with email** at `/login` or go to `/register`. This
works with Yahoo, Outlook, and other email providers; Google is optional.
Supabase remains the identity store. The registration flow requires matching
passwords of at least eight characters, acceptance of the terms, and email
confirmation. Pending plugin consent survives registration and sign-in.

Keep the Email provider and new sign-ups enabled in Supabase. Keep confirmation
emails enabled (`mailer_autoconfirm=false`). Configure a custom SMTP provider
under Authentication → Email → SMTP Settings. Supabase's built-in sender is
restricted and is not suitable for public signup; its default rate limits are
also low. Set the sender address, provider credentials, and delivery/rate limits
according to the mail provider's verified-domain setup. Store SMTP credentials
only in Supabase, not in the repository or plugin.

The default Supabase confirmation and recovery templates can use their
`ConfirmationURL` link. The application passes a PKCE callback at
`SITE_ORIGIN/auth/callback`, already covered by the configured redirect allowlist.
Open these links in the browser that started the request so its PKCE verifier
cookie is available. If a link expires or a different browser is used, request
a new confirmation or password-reset email from that browser.

`/forgot-password` requests recovery without revealing whether an account exists.
`/reset-password` requires an authenticated session, validates the new password,
and then lets the user continue to their library or pending plugin consent.
Existing accounts can sign in using email/password without sending an email.
Do not create an account or send test messages to someone else's address; the
owner completes registration and chooses their own password.

## MCP import workflow and client capabilities

MCP imports use the dedicated tool workflow in `lib/shelfie-mcp-instructions.ts`; the website's downloadable-file prompt is for manual JSON import. The assistant first inventories photos and saves all metadata using `create_collection` once and `update_collection` for later batches (maximum 100 books per call), without waiting for cover research. It then automatically follows the returned `nextAction`: `list_missing_covers`, client-side web searches, and `update_covers`, processing every missing-cover page in the same turn. It must check write results and return the confirmed collection URL/counts. Connecting or listing collections does not constitute an import.

The shelf-photo import workflow uses the client’s web/image search capability. Cover repair also uses client-side search: `list_missing_covers` reads the queue and `update_covers` saves URLs supplied by the client. File creation is not required for direct MCP import. Reconnect after instruction/schema changes; a new chat also avoids retaining conflicting earlier file-delivery instructions.

## Repair missing covers (MCP 1.11.0)

The CLIENT searches for covers; the backend only saves supplied cover metadata.

1. Get the real `collectionId` from `list_collections`.
2. Call `list_missing_covers({collectionId})`. This read-only tool returns up to
   five books, including UUID `id`, title, authors, language, publisher, series
   and volume. These IDs differ from legacy shelf labels such as `B1`.
3. Search each book online. Prefer its exact edition and language, then other
   editions of the same work. Verify the work and volume and obtain a direct,
   public HTTPS image URL, not a product-page URL.
4. Call `update_covers({collectionId, covers: [{bookId: book.id, coverUrl}]})`.
   Submit 1–50 distinct books per batch. URLs are required and cannot be null.
   The backend does not search, download or verify images. It validates URL syntax
   and conditionally saves the supplied metadata with client provenance.
5. Continue `list_missing_covers` using `nextCursor` as `after` while `hasMore`
   is true. Stable cursors prevent skips when saving covers between read pages.

Report confirmed `updated`, `skipped` and `failed` saves separately from unsuccessful
client searches. Do not invent URLs or submit unresolved searches. Existing covers
and owner uploads are preserved, including on retries. ISBNs and bibliographic
metadata are unchanged. Both tools require ownership and connected-client consent.
Reconnect clients to refresh the changed tool schemas; collection-only calls to
`update_covers` are now rejected before any write.

## Category tags (MCP 1.10.0)

Each ingested book must include `categories`, an array of 1–8 non-empty English
category tags (maximum 80 characters per tag). The client chooses supported
format, genre and subject tags from metadata, using consistent labels across
books. Examples: `["Fiction", "Fantasy"]`, `["Comics & Graphic Novels", "History"]`
and `["Tabletop Roleplaying", "Game Adventures", "Fantasy"]`. Do not classify RPG
manuals as novels just because their covers feature fantasy scenes. Use
`["Uncategorized"]` only when even a broad category is unsupported. Both import
tools validate the field before writing; the book-list tool returns saved tags.
Reconnect clients after deployment to refresh the schema. Older manual JSON files
remain importable without the new field; the copy-paste prompt now requests it.


## Two-step import (MCP 1.12.0)

Metadata is saved before cover research. In both import tools, `coverUrl` can be
omitted or null and search notes are not required. All other metadata validation,
including category tags, remains in place. Missing covers never block collection
creation. Each successful import returns `nextAction` with `list_missing_covers`
and the saved collection ID, plus instructions to finish all metadata batches
before automatically starting cover research and saving results with `update_covers`.
This continuation is handled by the client agent, without another user prompt.
Unsuccessful cover searches leave the collection and books intact; the client
reports metadata and cover outcomes separately. Reconnect clients to refresh
schemas, descriptions and initialization instructions. The website's manual JSON
prompt is unchanged.
