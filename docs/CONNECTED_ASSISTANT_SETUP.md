# Connected shelfie import — setup and rollout

The branch implements a ChatGPT-compatible MCP server, Supabase OAuth consent,
private import drafts, owner review, and the provider-neutral paste/file fallback.
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

## 2. Apply the database migration

In Supabase SQL Editor, run the entire file as a single transaction:

`supabase/migrations/202610100010_connected_shelfie_drafts.sql`

Prerequisite: migrations 001–009 already applied. The migration is one-time, not
idempotent. Existing browser imports keep their RPC names. Their implementations
move to the unexposed `private` schema so OAuth cannot bypass draft review by calling
the old security-definer functions. Do not expose `private` in the Data API settings.

The migration also restricts OAuth tokens at the table/RPC layer, adds a client
allowlist, per-user connection consent/revocation, draft deduplication, and a quota
of 30 newly created drafts per owner per 24 hours. There are no public draft policies.

## 3. Configure Supabase OAuth

1. Under Authentication → Signing Keys, use an asymmetric signing key (ES256 or
   RS256). The MCP server intentionally does not accept HS256/shared JWT secrets.
2. Set Auth Site URL to `SITE_ORIGIN`, and enable OAuth Server with Authorization
   Path `/oauth/consent`.
3. Register a dedicated OAuth client for myLibrary's ChatGPT connection. Prefer
   a pre-registered client with the exact callback URL shown in the ChatGPT
   connection/portal. Do not enable unrestricted dynamic registration for this
   integration. Never put the client secret in the prompt, repository, or MCP tools.
4. Add that client's ID and this deployment's MCP resource to the database:

```sql
insert into public.assistant_oauth_clients(client_id, resource_url)
values ('YOUR_OAUTH_CLIENT_ID', 'https://YOUR_SITE_ORIGIN/api/mcp');
```

5. Configure the **Custom Access Token Hook** to use
   `public.assistant_access_token_hook`. If you already have a hook, merge its
   required claims with this function rather than replacing it blindly. This hook
   preserves ordinary browser claims and binds allowlisted OAuth tokens to both
   `authenticated` and the registered `/api/mcp` audience. Unknown OAuth clients
   fail closed, so review existing OAuth integrations before enabling it.
6. Configure the ChatGPT connection with scope `openid` only. The consent page
   rejects broader identity scopes; it does not request email/profile access.

Authorization endpoint: `https://PROJECT.supabase.co/auth/v1/oauth/authorize`

Token endpoint: `https://PROJECT.supabase.co/auth/v1/oauth/token`

Discovery: `https://PROJECT.supabase.co/.well-known/oauth-authorization-server/auth/v1`

The MCP endpoint advertises protected-resource metadata at
`SITE_ORIGIN/.well-known/oauth-protected-resource` and the `/api/mcp` suffix variant.
Supabase handles OAuth codes, exact callbacks, PKCE and token refresh. The app
verifies JWT signatures, expiry, issuer, audience, user identity and live consent.

## 4. Set Vercel environment variables for the chosen branch/environment

```text
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
MYLIBRARY_SITE_URL=https://YOUR_SITE_ORIGIN
MYLIBRARY_MCP_ENABLED=true
```

Do not set a service-role key or an OpenAI API key. Redeploy after changing variables.
Keep `MYLIBRARY_MCP_ENABLED=false` until migration, client registration, and hook are
ready. On each deployment, use a resource URL matching its configured site origin.

## 5. Connect and test in ChatGPT

In an account that supports custom MCP connections, add `SITE_ORIGIN/api/mcp` with
OAuth, supplying the registered client credentials through the connection settings.
Enter the exact callback shown there in Supabase's client registration. Sign into
myLibrary and approve the named application on the consent screen.

Test with a small shelf photo:

1. Ask to list your collections, then choose one.
2. Ask to send the visible books for review. Confirm the assistant returns a review
   link and does not claim the books have been published.
3. Follow the link. Check titles, authors, uncertainty notes and visible ISBNs;
   uncheck one book and change another title.
4. Import. Only selected books should appear, followed by automatic ISBN matching.
5. Reopen the draft link: it must report that it was already imported.
6. Repeat the same tool payload: the draft ID must be unchanged.
7. Visit `/shelfies/connections` and revoke access. Further tool calls must fail,
   including with a previously issued access token. Reconnect through consent.

The user's signed-in account owns every draft; collection IDs never grant access.
Prompt injection in titles/notes cannot grant additional tools or SQL privileges.
The review UI renders book fields as text, never HTML.

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
