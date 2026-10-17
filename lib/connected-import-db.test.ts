import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("real migrations enforce private drafts, owner confirmation, idempotency and revocation", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    // Only Supabase's hosted auth/storage scaffolding is simulated; every app
    // migration, RLS policy, import transaction and crypto digest runs unchanged.
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
      create schema auth; create schema storage; create schema extensions;
      -- Hosted OAuth tables used by self-service consent (never app-owned tables).
      create table auth.oauth_clients(id uuid primary key, deleted_at timestamptz);
      create table auth.oauth_authorizations(
        authorization_id text primary key, client_id uuid references auth.oauth_clients,
        user_id uuid, resource text, scope text, status text, expires_at timestamptz,
        code_challenge text, code_challenge_method text
      );
      create extension pgcrypto with schema extensions;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
      grant usage on schema auth,storage,public to anon,authenticated;
      grant select,insert,update,delete on storage.objects to authenticated;
    `);
    const dir = path.join(process.cwd(), "supabase/migrations");
    for (const file of (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(path.join(dir, file), "utf8"));
    const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222";
    await db.query("insert into auth.users(id,email) values ($1,'alice@test.invalid'),($2,'bob@test.invalid')", [alice, bob]);
    const collections = (await db.query<{ id: string; owner_id: string }>("select id,owner_id from public.collections")).rows;
    const a = collections.find((row) => row.owner_id === alice)!.id, b = collections.find((row) => row.owner_id === bob)!.id;
    const resource = "https://library.test/api/mcp";
    await db.query("insert into public.assistant_oauth_clients values ('assistant', $1, true)", [resource]);
    const claims = async (owner: string, oauth = false, audience = resource) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, role: "authenticated", ...(oauth ? { client_id: "assistant", aud: ["authenticated", audience] } : {}) })]);
      await db.exec("set role authenticated");
    };
    const book = { position: 1, title: "The Hobbit", authors: ["Tolkien"], confidence: .9, visibleIsbn: null };
    const payload = { schemaVersion: "mylibrary.shelfie.v1", books: [book] };
    const rpc = async (name: string, args: unknown[]) => (await db.query<{ result: any }>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args)).rows[0].result;
    await claims(alice); await rpc("set_assistant_connection", ["assistant", true]);
    await claims(alice, true);
    assert.equal((await db.query("select * from public.collections")).rows.length, 1);
    await assert.rejects(() => rpc("create_shelfie_draft", [b, payload]), /denied/);
    const draft = await rpc("create_shelfie_draft", [a, payload]);
    assert.equal((await rpc("create_shelfie_draft", [a, payload])).draftId, draft.draftId);
    assert.equal((await db.query("select * from public.shelfie_import_drafts")).rows.length, 0);
    await assert.rejects(() => db.query("select private.import_manual_genai_books($1,$2,$3)", [a, draft.draftId, payload]), /permission denied/);
    await assert.rejects(() => db.query("insert into public.works(external_key,title,author) values ('bad','bad','bad')"), /row-level security/);
    await assert.rejects(() => db.query("insert into public.collections(owner_id,slug,name) values ($1,'bad','bad')", [alice]), /row-level security/);
    await assert.rejects(() => rpc("import_manual_genai_books", [a, draft.draftId, payload]), /Review and import/);
    await assert.rejects(() => rpc("confirm_shelfie_draft", [draft.draftId, payload]), /Browser sign-in/);
    await assert.rejects(() => rpc("publish_copy_draft", [draft.draftId]), /Browser sign-in/);
    await assert.rejects(() => rpc("consume_chatgpt_import", ["bad", []]), /Review and import/);
    await assert.rejects(() => rpc("set_assistant_connection", ["assistant", true]), /Browser sign-in/);
    await claims(bob);
    assert.equal((await db.query("select * from public.shelfie_import_drafts")).rows.length, 0);
    await assert.rejects(() => rpc("confirm_shelfie_draft", [draft.draftId, payload]), /not found/);
    await claims(alice);
    assert.equal((await db.query("select * from public.shelfie_import_drafts")).rows.length, 1);
    assert.equal((await db.query("select * from public.copies")).rows.length, 0);
    const imported = await rpc("confirm_shelfie_draft", [draft.draftId, { ...payload, books: [book, { ...book, position: 2, title: "" }] }]);
    assert.equal(imported.imported, 1);
    assert.deepEqual(await rpc("confirm_shelfie_draft", [draft.draftId, payload]), imported);
    assert.equal((await db.query("select * from public.copies")).rows.length, 1);
    await claims(alice, true);
    const listed = await rpc("assistant_list_collection_books", [a, 100, 0]);
    assert.equal(listed.total, 1); assert.equal(listed.books[0].title, "The Hobbit"); assert.equal(listed.hasMore, false);
    await assert.rejects(() => rpc("assistant_list_collection_books", [b, 100, 0]), /denied/);
    const rpgPayload = { ...payload, books: [{ ...book, title: "RPG Book", isbn: "9780261102217", coverUrl: "https://images.example.test/rpg-book.jpg" }] };
    const createdCollection = await rpc("assistant_create_collection", ["RPG", "Games", rpgPayload]);
    assert.equal(createdCollection.name, "RPG");
    assert.match(createdCollection.slug, /^collection-[a-f0-9]{12}$/);
    assert.equal(createdCollection.imported, 1);
    const createdBooks = await rpc("assistant_list_collection_books", [createdCollection.collectionId, 100, 0]);
    assert.equal(createdBooks.total, 1); assert.equal(createdBooks.books[0].isbn13, "9780261102217");
    const appendedPayload = { ...payload, books: [book, { ...book, position: 2, title: "Appended book" }] };
    const appended = await rpc("assistant_update_collection", [a, appendedPayload]);
    assert.equal(appended.imported, 1); assert.equal(appended.ignoredExisting, 1);
    const repeated = await rpc("assistant_update_collection", [a, appendedPayload]);
    assert.equal(repeated.duplicate, true); assert.equal(repeated.imported, 0); assert.equal(repeated.ignoredExisting, 2);
    assert.equal((await rpc("assistant_list_collection_books", [a, 100, 0])).total, 2);
    await claims(alice);
    const completedImport = (await db.query<{ matching_status: string }>("select matching_status from public.manual_genai_imports where id = $1", [createdCollection.importId])).rows[0];
    assert.equal(completedImport.matching_status, "completed");
    assert.equal((await db.query<{ ingestion_status: string }>("select ingestion_status from public.manual_genai_imports where id=$1", [createdCollection.importId])).rows[0].ingestion_status, "completed", "a fully supplied import completes immediately");
    const createdCopy = (await db.query<{ id: string; work_id: string }>("select id,work_id from public.copies where collection_id = $1", [createdCollection.collectionId])).rows[0];
    assert.equal((await db.query<{ cover_url: string; cover_source: string }>("select cover_url,cover_source from public.copies where id = $1", [createdCopy.id])).rows[0].cover_url, "https://images.example.test/rpg-book.jpg");
    assert.equal((await db.query<{ status: string }>("select status from public.book_observations where copy_id = $1", [createdCopy.id])).rows[0].status, "cover_provided");
    await db.exec("reset role");
    assert.equal((await db.query<{ status: string }>("select status from public.cover_resolution_jobs where isbn13 = '9780261102217'")).rows[0].status, "completed");
    assert.equal((await db.query<{ table_name: string | null }>("select to_regclass('public.ingestion_pipeline_runs')::text as table_name")).rows[0].table_name, null);
    await assert.rejects(() => db.query("update public.manual_genai_imports set matching_status='partial' where id=$1", [createdCollection.importId]), /manual_genai_matching_status_check/);
    await db.query("update public.cover_resolution_jobs set status='failed', next_retry_at=now()-interval '1 minute' where isbn13='9780261102217'");
    assert.equal((await db.query("select * from public.claim_next_cover_resolution()")).rows.length, 1, "failed cover jobs are retryable when due");
    await db.query("update public.cover_resolution_jobs set status='completed' where isbn13='9780261102217'");
    await claims(alice);
    await claims(bob); await assert.rejects(() => rpc("delete_owned_book", [createdCopy.id]), /not found/);
    await claims(alice); assert.equal(await rpc("delete_owned_book", [createdCopy.id]), true);
    assert.equal((await db.query("select * from public.copies where id = $1", [createdCopy.id])).rows.length, 0);
    assert.equal((await db.query("select * from public.works where id = $1", [createdCopy.work_id])).rows.length, 0);
    await claims(bob); await assert.rejects(() => rpc("delete_owned_collection", [createdCollection.collectionId]), /not found/);
    await claims(alice); assert.equal(await rpc("delete_owned_collection", [createdCollection.collectionId]), true);
    assert.equal((await db.query("select * from public.collections where id = $1", [createdCollection.collectionId])).rows.length, 0);
    await claims(alice, true);
    const otherPayload = { ...payload, books: [{ ...book, title: "Second book" }] };
    const discarded = await rpc("create_shelfie_draft", [a, otherPayload]);
    await claims(alice); await rpc("discard_shelfie_draft", [discarded.draftId]);
    await assert.rejects(() => rpc("confirm_shelfie_draft", [discarded.draftId, otherPayload]), /discarded/);
    await rpc("set_assistant_connection", ["assistant", false]);
    await claims(alice, true);
    assert.equal(await rpc("assistant_connection_allowed", []), false);
    await assert.rejects(() => rpc("create_shelfie_draft", [a, payload]), /denied/);
    assert.equal((await db.query("select * from public.collections")).rows.length, 0);
    await claims(alice); await rpc("set_assistant_connection", ["assistant", true]);
    await claims(alice, true, "https://wrong.test/api/mcp");
    assert.equal(await rpc("assistant_connection_allowed", []), false);
    await db.exec("reset role");
    const hooked = await rpc("assistant_access_token_hook", [{ client_id: "assistant", claims: { sub: alice, aud: "authenticated" } }]);
    assert.deepEqual(hooked.claims.aud, ["authenticated", resource]);
    assert.equal(hooked.claims.client_id, "assistant");
    await assert.rejects(() => rpc("assistant_access_token_hook", [{ client_id: "unknown", claims: { sub: alice } }]), /not enabled/);

    // A dynamically registered client needs the current user's explicit consent.
    const dynamicClient = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into private.assistant_oauth_settings values (true,$1)", [resource]);
    await db.query("insert into auth.oauth_clients(id) values ($1)", [dynamicClient]);
    await db.query(`insert into auth.oauth_authorizations values
      ('new-client', $1, $2, $3, 'openid email offline_access', 'pending', now() + interval '10 minutes', 'challenge', 's256')`, [dynamicClient, alice, resource]);
    await claims(bob);
    assert.equal(await rpc("assistant_authorization_allowed", ["new-client"]), false);
    await assert.rejects(() => rpc("authorize_assistant_connection", ["new-client"]), /invalid/);
    await claims(alice, true);
    assert.equal(await rpc("assistant_authorization_allowed", ["new-client"]), false);
    await claims(alice);
    assert.equal(await rpc("assistant_authorization_allowed", ["new-client"]), true);
    await rpc("authorize_assistant_connection", ["new-client"]);
    await rpc("authorize_assistant_connection", ["new-client"]); // idempotent consent
    await db.exec("reset role");
    const consent = (await db.query<{ owner_id: string }>("select owner_id from public.assistant_connections where client_id=$1", [dynamicClient])).rows;
    assert.deepEqual(consent.map((row) => row.owner_id), [alice]);
    for (const [owner, expected] of [[alice, true], [bob, false]] as const) {
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, role: "authenticated", client_id: dynamicClient, aud: ["authenticated", resource] })]);
      await db.exec("set role authenticated");
      assert.equal(await rpc("assistant_connection_allowed", []), expected);
      await db.exec("reset role");
    }

    const dynamicHook = await rpc("assistant_access_token_hook", [{ client_id: dynamicClient, claims: { sub: alice, aud: "authenticated" } }]);
    assert.deepEqual(dynamicHook.claims.aud, ["authenticated", resource]);
    const googleBrowserClaims = { sub: alice, aud: "authenticated", role: "authenticated" };
    assert.deepEqual((await rpc("assistant_access_token_hook", [{ authentication_method: "oauth", claims: googleBrowserClaims }])).claims, googleBrowserClaims);

    // No expiry, scope, resource, PKCE, or administrator block can be bypassed.
    for (const [column, value] of [
      ["scope", "openid admin"], ["resource", "https://wrong.test/api/mcp"],
      ["code_challenge_method", "plain"], ["code_challenge", ""],
      ["status", "denied"], ["expires_at", "2000-01-01T00:00:00Z"],
    ]) {
      await db.query(`update auth.oauth_authorizations set ${column}=$1 where authorization_id='new-client'`, [value]);
      await claims(alice);
      assert.equal(await rpc("assistant_authorization_allowed", ["new-client"]), false, column);
      await assert.rejects(() => rpc("authorize_assistant_connection", ["new-client"]), /invalid/);
      await db.exec("reset role");
      await db.query(`update auth.oauth_authorizations set scope='openid', resource=$1, code_challenge_method='s256', code_challenge='challenge', status='pending', expires_at=now()+interval '10 minutes' where authorization_id='new-client'`, [resource]);
    }
    await db.query("update public.assistant_oauth_clients set enabled=false where client_id=$1", [dynamicClient]);
    await claims(alice);
    assert.equal(await rpc("assistant_authorization_allowed", ["new-client"]), false);
    await assert.rejects(() => rpc("authorize_assistant_connection", ["new-client"]), /invalid/);
    await db.exec("reset role");
    await db.query("update public.assistant_oauth_clients set enabled=true where client_id=$1", [dynamicClient]);
    await claims(alice);
    await rpc("set_assistant_connection", [dynamicClient, false]);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: alice, role: "authenticated", client_id: dynamicClient, aud: ["authenticated", resource] })]);
    await db.exec("set role authenticated");
    assert.equal(await rpc("assistant_connection_allowed", []), false);

    // ISBN selection must not assign a cover until Stage 3 has a real image.
    await db.exec("reset role");
    const workId = (await db.query<{ id: string }>("insert into public.works(external_key,title,author) values ('stage-boundary','Boundary book','Author') returning id")).rows[0].id;
    const copyId = (await db.query<{ id: string }>("insert into public.copies(collection_id,work_id,legacy_id,display_order,category,language) values ($1,$2,'stage-boundary',999,'Other','en') returning id", [a, workId])).rows[0].id;
    await db.query("insert into public.edition_candidates(copy_id,isbn13,provider,provider_id,title,rank,score,auto_accept,work_confidence,edition_confidence) values ($1,'9780140328721','isbn-matcher-v3','boundary','Boundary book',1,900,true,.99,.99)", [copyId]);
    const stage2Copy = (await db.query<{ edition_id: string; cover_url: string | null }>("select edition_id,cover_url from public.copies where id=$1", [copyId])).rows[0];
    assert.ok(stage2Copy.edition_id);
    assert.equal(stage2Copy.cover_url, null);
    assert.equal((await db.query("select * from public.copy_cover_selections where copy_id=$1", [copyId])).rows.length, 0);
    await rpc("attach_resolved_isbn_covers", []);
    assert.equal((await db.query("select * from public.copy_cover_selections where copy_id=$1", [copyId])).rows.length, 0, "pending ISBN jobs cannot assign images");
    await db.query("update public.cover_resolution_jobs set status='completed',source='openlibrary' where isbn13='9780140328721'");
    await rpc("attach_resolved_isbn_covers", []);
    assert.match((await db.query<{ cover_url: string }>("select cover_url from public.copies where id=$1", [copyId])).rows[0].cover_url, /^\/api\/cover-assets\//);
    assert.equal(await rpc("attach_resolved_isbn_covers", []), 0, "attachment is idempotent");

    // Only finished ISBN matching releases cover work. A genuine miss completes
    // ingestion and cannot be claimed again, including by the hourly worker.
    const retryImport = "99999999-1111-4111-8111-111111111111";
    await db.query("insert into public.manual_genai_imports(id,collection_id,owner_id,schema_version,payload_checksum,book_count) values ($1,$2,$3,'mylibrary.shelfie.v1','retry-boundary',1)", [retryImport, a, alice]);
    await db.query("insert into public.book_observations(collection_id,copy_id,source_type,manual_genai_import_id,status) values ($1,$2,'manual_genai_json',$3,'ready_for_matching')", [a, copyId, retryImport]);
    await db.query("update public.copies set cover_url=null where id=$1", [copyId]);
    await db.query("update public.manual_genai_imports set matching_status='completed' where id<>$1", [retryImport]);
    await db.query("update public.copies set cover_status='cover_not_found' where id<>$1 and cover_url is null", [copyId]);
    assert.equal(await rpc("claim_next_book_cover", []), null, "ISBN work must finish first");
    await db.query("update public.book_observations set status='matched' where manual_genai_import_id=$1", [retryImport]);
    await rpc("finish_isbn_matching", [retryImport]);
    await rpc("refresh_ingestion_statuses", []);
    assert.equal((await db.query<{ ingestion_status: string }>("select ingestion_status from public.manual_genai_imports where id=$1", [retryImport])).rows[0].ingestion_status, "processing");
    assert.equal(await rpc("claim_next_book_cover", []), copyId);
    assert.equal(await rpc("claim_next_book_cover", []), null, "active claims cannot overlap");
    await db.query("update public.copies set cover_started_at=now()-interval '11 minutes' where id=$1", [copyId]);
    assert.equal(await rpc("claim_next_book_cover", []), copyId, "stuck work is reclaimed");
    await db.query("update public.copies set cover_status='failed',cover_next_retry_at=now()+interval '1 hour' where id=$1", [copyId]);
    assert.equal(await rpc("claim_next_book_cover", []), null, "failed work respects the retry delay");
    await db.query("update public.copies set cover_next_retry_at=now()-interval '1 minute' where id=$1", [copyId]);
    assert.equal(await rpc("claim_next_book_cover", []), copyId, "due failures are reclaimed");
    await db.query("update public.copies set cover_status='cover_not_found',cover_completed_at=now() where id=$1", [copyId]);
    assert.equal((await db.query<{ ingestion_status: string }>("select ingestion_status from public.manual_genai_imports where id=$1", [retryImport])).rows[0].ingestion_status, "completed");
    assert.equal(await rpc("claim_next_book_cover", []), null, "not-found is terminal");
    assert.equal((await db.query<{ cover_url: string }>("select cover_url from public.public_catalogue where legacy_id='stage-boundary'")).rows[0].cover_url, "/covers/cover-not-found.svg", "terminal misses display the shared default image");
    assert.equal((await db.query<{ cover_url: string | null }>("select cover_url from public.copies where id=$1", [copyId])).rows[0].cover_url, null, "a placeholder must not be stored as a found cover");
    await db.query("update public.copies set cover_url='https://images.example.test/owner.jpg' where id=$1", [copyId]);
    assert.equal((await db.query<{ cover_status: string }>("select cover_status from public.copies where id=$1", [copyId])).rows[0].cover_status, "completed", "owner-supplied covers complete work");
    await db.query("update public.manual_genai_imports set matching_status='failed',next_retry_at=now()+interval '1 hour' where id=$1", [retryImport]);
    await db.query("update public.manual_genai_imports set matching_status='completed' where id<>$1", [retryImport]);
    assert.equal(await rpc("claim_next_isbn_match", []), null, "ISBN failures wait until due");
    await db.query("update public.manual_genai_imports set next_retry_at=now()-interval '1 minute' where id=$1", [retryImport]);
    assert.equal(await rpc("claim_next_isbn_match", []), retryImport);
    await db.query("update public.manual_genai_imports set matching_started_at=now()-interval '11 minutes' where id=$1", [retryImport]);
    assert.equal(await rpc("claim_next_isbn_match", []), retryImport, "stalled ISBN matching is recovered");
    await db.query("update public.book_observations set status='ready_for_matching' where manual_genai_import_id=$1", [retryImport]);
    await rpc("finish_isbn_matching", [retryImport]);
    const retryState = (await db.query<{ matching_status: string; retryable_count: number; next_tick: boolean }>("select matching_status,retryable_count,next_retry_at=date_trunc('hour',now())+interval '1 hour' as next_tick from public.manual_genai_imports where id=$1", [retryImport])).rows[0];
    assert.equal(retryState.matching_status, "failed");
    assert.equal(retryState.retryable_count, 1);
    assert.equal(retryState.next_tick, true);
  } finally { await db.close(); }
});
