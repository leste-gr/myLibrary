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
    assert.equal(createdBooks.total, 1); assert.equal(createdBooks.books[0].isbn13, null);
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
    assert.equal((await db.query("select * from public.edition_candidates where copy_id=$1", [createdCopy.id])).rows.length, 0, "import ignores legacy ISBN arguments");
    assert.equal((await db.query("select * from public.cover_resolution_jobs where isbn13='9780261102217'")).rows.length, 0);
    assert.equal((await db.query<{ table_name: string | null }>("select to_regclass('public.ingestion_pipeline_runs')::text as table_name")).rows[0].table_name, null);
    await assert.rejects(() => db.query("update public.manual_genai_imports set matching_status='partial' where id=$1", [createdCollection.importId]), /manual_genai_matching_status_check/);
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
    assert.equal(stage2Copy.edition_id, null, "candidate insertion no longer auto-selects ISBNs");
    assert.equal(stage2Copy.cover_url, null);
    assert.equal((await db.query("select * from public.copy_cover_selections where copy_id=$1", [copyId])).rows.length, 0);
    // Cover work runs directly, independent of legacy matching state.
    const retryImport = "99999999-1111-4111-8111-111111111111";
    await db.query("insert into public.manual_genai_imports(id,collection_id,owner_id,schema_version,payload_checksum,book_count) values ($1,$2,$3,'mylibrary.shelfie.v1','retry-boundary',1)", [retryImport, a, alice]);
    await db.query("insert into public.book_observations(collection_id,copy_id,source_type,manual_genai_import_id,status) values ($1,$2,'manual_genai_json',$3,'ready_for_matching')", [a, copyId, retryImport]);
    await db.query("update public.copies set cover_url=null where id=$1", [copyId]);
    assert.equal((await db.query<{ cover_url: string }>("select cover_url from public.public_catalogue where legacy_id='stage-boundary'")).rows[0].cover_url, "/covers/cover-not-found.svg", "new pending books use the default image immediately");
    await db.query("update public.manual_genai_imports set matching_status='completed' where id<>$1", [retryImport]);
    await db.query("update public.copies set cover_status='cover_not_found' where id<>$1 and cover_url is null", [copyId]);
    await db.query("update public.manual_genai_imports set matching_status='failed',matching_error='legacy failure' where id=$1", [retryImport]);
    await db.query("update public.book_observations set status='matched' where manual_genai_import_id=$1", [retryImport]);
    await rpc("finish_isbn_matching", [retryImport]);
    await rpc("refresh_ingestion_statuses", []);
    assert.equal((await db.query<{ ingestion_status: string }>("select ingestion_status from public.manual_genai_imports where id=$1", [retryImport])).rows[0].ingestion_status, "pending");
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
    assert.equal(await rpc("claim_next_isbn_match", []), null, "automatic ISBN queue is disabled");
    await rpc("finish_isbn_matching", [retryImport]);
    const retryState = (await db.query<{ matching_status: string; retryable_count: number; next_retry_at: string | null }>("select matching_status,retryable_count,next_retry_at from public.manual_genai_imports where id=$1", [retryImport])).rows[0];
    assert.equal(retryState.matching_status, "completed");
    assert.equal(retryState.retryable_count, 0);
    assert.equal(retryState.next_retry_at, null);

    // A cover upload belongs to one physical book, survives automated choices,
    // and follows the collection's public/private visibility in Storage.
    const uploadedPath = `${alice}/${copyId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
    await claims(alice);
    await db.query("insert into storage.objects(bucket_id,name) values ('book-covers',$1)", [uploadedPath]);
    await rpc("set_owned_book_cover", [copyId, uploadedPath]);
    assert.equal((await db.query<{ ingestion_status: string }>("select ingestion_status from public.manual_genai_imports where id=$1", [retryImport])).rows[0].ingestion_status, "completed", "an owner cover finishes previously blocked cover work");
    const uploadUrl = `/api/book-covers/${copyId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
    assert.equal((await db.query<{ cover_url: string; cover_source: string }>("select cover_url,cover_source from public.copies where id=$1", [copyId])).rows[0].cover_url, uploadUrl);
    await claims(bob);
    await assert.rejects(() => rpc("set_owned_book_cover", [copyId, uploadedPath]), /ownership/);
    await assert.rejects(() => db.query("insert into storage.objects(bucket_id,name) values ('book-covers',$1)", [`${alice}/${copyId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`]), /row-level security/);
    await db.exec("reset role");
    await db.query("update public.copies set cover_url='/api/covers/9780140328721',cover_source='isbn-resolver' where id=$1", [copyId]);
    assert.equal((await db.query<{ cover_url: string }>("select cover_url from public.copies where id=$1", [copyId])).rows[0].cover_url, uploadUrl, "automation cannot replace the uploaded cover");
    assert.equal((await db.query<{ decision_source: string }>("select decision_source from public.copy_cover_selections where copy_id=$1", [copyId])).rows[0].decision_source, "owner");
    await db.query("select set_config('request.jwt.claims','{}',false)");
    await db.exec("set role anon");
    assert.equal((await db.query("select * from storage.objects where name=$1", [uploadedPath])).rows.length, 1, "public books expose their cover");
    await db.exec("reset role");
    await db.query("update public.collections set is_public=false where id=$1", [a]);
    await db.exec("set role anon");
    assert.equal((await db.query("select * from storage.objects where name=$1", [uploadedPath])).rows.length, 0, "private collection covers stay private");
    await claims(alice);
    assert.equal((await db.query("select * from storage.objects where name=$1", [uploadedPath])).rows.length, 1, "the owner can still view a private cover");

    // Manual Stage 2 never publishes even an overwhelming top-ranked match.
    const snapshot = async () => (await db.query<{ value: unknown }>(
      "select to_jsonb(c)-'last_isbn_candidate_search_at'-'last_isbn_search_provider_failures' as value from public.copies c where id=$1", [copyId])).rows[0].value;
    const beforeSearch = await snapshot();
    const jobBefore = (await db.query("select * from public.manual_genai_imports where id=$1", [retryImport])).rows;
    const observationsBefore = (await db.query("select * from public.book_observations where copy_id=$1 order by id", [copyId])).rows;
    const candidate = (isbn13: string, score: number) => ({ isbn13, score, title: "Manual result", publishers: [], publishedDate: "1954", providerId: isbn13, confidence: 1, evidence: [], scoreBreakdown: {}, providerCount: 2, providerIdentifiers: {}, workConfidence: 1, editionConfidence: 1, autoAccept: true });
    const results = [candidate("9780261102217", 9999), candidate("9780140328721", 500)];
    assert.equal(await rpc("save_book_isbn_search", [copyId, JSON.stringify(results), 0]), 2);
    assert.deepEqual(await snapshot(), beforeSearch, "ISBN, every book status, cover, and timestamps stay unchanged");
    assert.deepEqual((await db.query("select * from public.manual_genai_imports where id=$1", [retryImport])).rows, jobBefore);
    assert.deepEqual((await db.query("select * from public.book_observations where copy_id=$1 order by id", [copyId])).rows, observationsBefore);
    const ranked = (await db.query<{ isbn13: string; review_only: boolean; auto_accept: boolean; manual_search_rank: number }>("select isbn13,review_only,auto_accept,manual_search_rank from public.edition_candidates where copy_id=$1 and manual_search_rank is not null order by manual_search_rank", [copyId])).rows;
    assert.deepEqual(ranked.map(row => row.isbn13), results.map(row => row.isbn13));
    assert.ok(ranked.every(row => row.review_only && !row.auto_accept));
    await db.exec("reset role");
    assert.equal((await db.query("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='apply_best_isbn_candidate'")).rows.length, 0);
    assert.deepEqual(await snapshot(), beforeSearch, "review-only results cannot be automatically selected later");
    await db.query("update public.copies set edition_verification_state='unresolved',cover_status='failed' where id=$1", [copyId]);
    await claims(alice);
    const failedSnapshot = await snapshot();
    assert.equal(await rpc("save_book_isbn_search", [copyId, JSON.stringify(results), 1]), 2);
    assert.deepEqual(await snapshot(), failedSnapshot, "manual search runs regardless of current book status");
    assert.equal(await rpc("save_book_isbn_search", [copyId, "[]", 0]), 0);
    assert.equal((await db.query("select id from public.edition_candidates where copy_id=$1 and manual_search_rank is not null", [copyId])).rows.length, 0);
    assert.deepEqual(await snapshot(), failedSnapshot, "empty results do not change status either");
    await claims(bob);
    await assert.rejects(() => rpc("save_book_isbn_search", [copyId, JSON.stringify(results), 0]), /ownership/);

    // Saving an ISBN draft must not publish its cover or metadata early.
    await claims(alice);
    const originalBook = await snapshot();
    const details = { title: "The Fellowship of the Ring", authors: ["J. R. R. Tolkien"], publishers: ["Allen & Unwin"], publishedDate: "1954", language: "en" };
    await db.exec("reset role");
    const siblingId = (await db.query<{ id: string }>("insert into public.copies(legacy_id,work_id,collection_id,display_order,category,language) select 'same-work-sibling',work_id,collection_id,999,category,language from public.copies where id=$1 returning id", [copyId])).rows[0].id;
    await claims(alice);
    const siblingBefore = (await db.query("select c.*,w.title,w.author from public.copies c join public.works w on w.id=c.work_id where c.id=$1", [siblingId])).rows;
    await rpc("save_owned_isbn_draft", [copyId, "9780261102217", JSON.stringify(details), null]);
    assert.deepEqual(await snapshot(), originalBook, "a saved draft never changes the published copy");
    const savedDraft = (await db.query<{ cover_url: string; edition_metadata: unknown }>("select cover_url,edition_metadata from public.copy_drafts where copy_id=$1", [copyId])).rows[0];
    assert.equal((await db.query<{ source_url: string }>("select source_url from public.cover_assets where id=split_part($1,'/',4)::uuid", [savedDraft.cover_url])).rows[0].source_url, "/api/covers/9780261102217", "preview resolves the chosen ISBN");
    assert.deepEqual(savedDraft.edition_metadata, { ...details, selectedCandidateId: null });
    await claims(bob);
    await assert.rejects(() => rpc("save_owned_isbn_draft", [copyId, "9780261102217", JSON.stringify(details), null]), /ownership/);
    await assert.rejects(() => rpc("publish_copy_draft", [copyId]), /ownership/);
    await claims(alice, true);
    await assert.rejects(() => rpc("save_owned_isbn_draft", [copyId, "9780261102217", JSON.stringify(details), null]), /Browser/);
    await claims(alice);
    await rpc("publish_copy_draft", [copyId]);
    const published = (await db.query<{ title: string; author: string; publisher: string; language: string; published_date: string; isbn13: string; cover_url: string }>("select w.title,w.author,c.publisher,c.language,e.published_date,e.isbn13,c.cover_url from public.copies c join public.works w on w.id=c.work_id join public.editions e on e.id=c.edition_id where c.id=$1", [copyId])).rows[0];
    assert.deepEqual(published, { title: details.title, author: details.authors[0], publisher: details.publishers[0], language: "en", published_date: "1954", isbn13: "9780261102217", cover_url: uploadUrl });
    assert.deepEqual((await db.query("select c.*,w.title,w.author from public.copies c join public.works w on w.id=c.work_id where c.id=$1", [siblingId])).rows, siblingBefore, "other copies sharing the old work are unchanged");
    assert.equal((await db.query("select * from public.copy_drafts where copy_id=$1", [copyId])).rows.length, 0);
    // Candidate and manual entry share the same draft transaction.
    await db.exec("reset role");
    await db.query("insert into public.editions(isbn13,title) values ('9780140328721','Boundary book')");
    await claims(alice);
    await rpc("save_book_isbn_search", [siblingId, JSON.stringify([candidate("9780140328721",500)]), 0]);
    const chosenId = (await db.query<{id:string}>("select id from public.edition_candidates where copy_id=$1 and isbn13='9780140328721'", [siblingId])).rows[0].id;
    const candidateDetails = { title: "Matilda", authors: ["Roald Dahl"], publishers: ["Puffin"], publishedDate: "1988", language: "en" };
    await rpc("save_owned_isbn_draft", [siblingId, "9780140328721", JSON.stringify(candidateDetails), chosenId]);
    const previewCover = (await db.query<{cover_url:string}>("select cover_url from public.copy_drafts where copy_id=$1", [siblingId])).rows[0].cover_url;
    assert.equal((await db.query<{title:string}>("select title from public.editions where isbn13='9780140328721'")).rows[0].title, "Boundary book", "saving a draft does not edit a shared edition");
    await rpc("publish_copy_draft", [siblingId]);
    const candidatePublished = (await db.query<{title:string;author:string;cover_url:string}>("select w.title,w.author,c.cover_url from public.copies c join public.works w on w.id=c.work_id where c.id=$1", [siblingId])).rows[0];
    assert.deepEqual(candidatePublished, {title:"Matilda",author:"Roald Dahl",cover_url:previewCover}, "published candidate uses exactly the previewed cover and metadata");

    // Camera/manual ISBN creation is owner-only, atomic and idempotent.
    await claims(alice);
    const scanMetadata = { title: "Camera book", authors: ["Scan author"], publishers: ["Scan press"], language: "en", publishedDate: "2024" };
    const scanRequest = "88888888-1111-4111-8111-111111111111";
    const importCount = (await db.query("select id from public.manual_genai_imports")).rows.length;
    const scanned = await rpc("add_owned_isbn_book", [a, "9780306406157", JSON.stringify(scanMetadata), scanRequest]);
    assert.equal(scanned.duplicate, false);
    const added = (await db.query<{ title: string; isbn13: string; edition_verification_state: string }>("select w.title,e.isbn13,c.edition_verification_state from public.copies c join public.works w on w.id=c.work_id join public.editions e on e.id=c.edition_id where c.id=$1", [scanned.copyId])).rows[0];
    assert.deepEqual(added, { title: "Camera book", isbn13: "9780306406157", edition_verification_state: "owner_confirmed" });
    assert.equal((await db.query("select id from public.manual_genai_imports")).rows.length, importCount, "owner scans never enter shelf-photo matching queues");
    assert.equal((await db.query<{source_type:string}>("select source_type from public.book_observations where copy_id=$1",[scanned.copyId])).rows[0].source_type,"barcode");
    const retryScan = await rpc("add_owned_isbn_book", [a,"9780306406157",JSON.stringify(scanMetadata),scanRequest]);
    assert.equal(retryScan.copyId,scanned.copyId); assert.equal(retryScan.duplicate,true);
    const repeatedScan = await rpc("add_owned_isbn_book", [a,"9780306406157",JSON.stringify(scanMetadata),"88888888-2222-4222-8222-222222222222"]);
    assert.equal(repeatedScan.copyId,scanned.copyId); assert.equal(repeatedScan.duplicate,true);
    await assert.rejects(() => rpc("add_owned_isbn_book",[b,"9780306406157",JSON.stringify(scanMetadata),scanRequest]),/ownership/);
    await assert.rejects(() => rpc("add_owned_isbn_book",[a,"9780306406158",JSON.stringify(scanMetadata),scanRequest]),/checksum/);
    const countBeforeInvalid = (await db.query("select id from public.copies")).rows.length;
    await assert.rejects(() => rpc("add_owned_isbn_book",[a,"9780131103627",JSON.stringify({...scanMetadata,title:""}),"88888888-3333-4333-8333-333333333333"]),/details/);
    assert.equal((await db.query("select id from public.copies")).rows.length,countBeforeInvalid,"invalid details create no partial book");
    await claims(alice,true);
    await assert.rejects(() => rpc("add_owned_isbn_book",[a,"9780306406157",JSON.stringify(scanMetadata),scanRequest]),/Browser/);
    await claims(bob);
    const secondOwner = await rpc("add_owned_isbn_book",[b,"9780306406157",JSON.stringify({...scanMetadata,title:"Another owner's copy"}),"88888888-4444-4444-8444-444444444444"]);
    assert.notEqual(secondOwner.copyId,scanned.copyId);
    await db.exec("reset role");
    assert.equal((await db.query<{title:string}>("select w.title from public.copies c join public.works w on w.id=c.work_id where c.id=$1",[scanned.copyId])).rows[0].title,"Camera book","shared ISBN never rewrites another owner's book");

    // Reading status belongs to the physical copy and changes on the catalogue.
    await claims(alice);
    const reading = async () => (await db.query<{reading_status:string}>("select reading_status from public.copies where id=$1",[scanned.copyId])).rows[0].reading_status;
    assert.equal(await reading(),"unread");
    await rpc("set_owned_book_reading_status",[a,scanned.legacyId,"read"]);
    assert.equal(await reading(),"read");
    await rpc("set_owned_book_reading_status",[a,scanned.legacyId,"radar"]);
    assert.equal(await reading(),"radar");
    await assert.rejects(()=>rpc("set_owned_book_reading_status",[a,scanned.legacyId,"invalid"]),/Invalid reading status/);
    assert.equal(await reading(),"radar");
    await assert.rejects(()=>rpc("set_owned_book_reading_status",[a,"missing-book","read"]),/not found/);
    await claims(bob);
    await assert.rejects(()=>rpc("set_owned_book_reading_status",[a,scanned.legacyId,"read"]),/ownership/);
    assert.equal((await db.query<{reading_status:string}>("select reading_status from public.copies where id=$1",[secondOwner.copyId])).rows[0].reading_status,"unread","same ISBN in another collection retains its own status");
    await claims(alice,true);
    await assert.rejects(()=>rpc("set_owned_book_reading_status",[a,scanned.legacyId,"read"]),/Browser/);
    await db.exec("reset role");
    await db.query("update public.collections set is_public=true where id=$1",[a]);
    await db.exec("set role anon");
    assert.equal((await db.query<{reading_status:string}>("select reading_status from public.public_catalogue where legacy_id=$1",[scanned.legacyId])).rows[0].reading_status,"radar","public visitors can see the saved status");
    await assert.rejects(()=>rpc("set_owned_book_reading_status",[a,scanned.legacyId,"read"]),/permission denied/);

    // Bulk status updates are atomic, collection-scoped and browser-owner-only.
    await claims(alice);
    assert.equal(await rpc("set_owned_books_reading_status",[a,[scanned.legacyId,"stage-boundary"],"read"]),2);
    assert.equal(await reading(),"read");
    await assert.rejects(()=>rpc("set_owned_books_reading_status",[a,[scanned.legacyId,secondOwner.legacyId],"unread"]),/no longer belong/);
    assert.equal(await reading(),"read","mixed collection batch changes no books");
    await assert.rejects(()=>rpc("set_owned_books_reading_status",[a,[scanned.legacyId,"missing"],"radar"]),/no longer belong/);
    assert.equal(await reading(),"read","missing book batch changes no books");
    for (const ids of [[],[scanned.legacyId,scanned.legacyId],[null]]) {
      await assert.rejects(()=>rpc("set_owned_books_reading_status",[a,ids,"unread"]),/distinct books/);
    }
    await assert.rejects(()=>rpc("set_owned_books_reading_status",[a,[scanned.legacyId],"invalid"]),/Invalid reading status/);
    assert.equal(await rpc("set_owned_books_reading_status",[a,[scanned.legacyId,"stage-boundary"],"radar"]),2);
    await claims(bob);
    await assert.rejects(()=>rpc("set_owned_books_reading_status",[a,[scanned.legacyId],"read"]),/ownership/);
    await claims(alice,true);
    await assert.rejects(()=>rpc("set_owned_books_reading_status",[a,[scanned.legacyId],"read"]),/Browser/);
    await db.exec("reset role; set role anon");
    await assert.rejects(()=>rpc("set_owned_books_reading_status",[a,[scanned.legacyId],"read"]),/permission denied/);
    // Cover repair is owner/consent scoped, keyset paginated and conditional.
    await claims(alice);
    await rpc("set_assistant_connection",["assistant",true]);
    await db.exec("reset role");
    const coverCollection = (await db.query<{id:string}>("insert into public.collections(owner_id,slug,name) values ($1,'cover-repair-test','Cover repair test') returning id",[alice])).rows[0].id;
    const coverIds = ["f0000000-0000-4000-8000-000000000001","f0000000-0000-4000-8000-000000000002","f0000000-0000-4000-8000-000000000003"];
    const coverWork = (await db.query<{id:string}>("insert into public.works(external_key,title,author) values ('cover-repair-test','Cover test','Cover author') returning id")).rows[0].id;
    for (const [index,id] of coverIds.entries()) await db.query("insert into public.copies(id,collection_id,legacy_id,work_id,reading_status,display_order,category,language) values ($1,$2,$3,$4,'radar',1,'Books','en')",[id,coverCollection,`cover-repair-${index}`,coverWork]);
    await claims(alice,true);
    const afterOldBooks = "efffffff-ffff-4fff-8fff-ffffffffffff";
    const covers = await rpc("assistant_list_missing_covers",[coverCollection,afterOldBooks,2]);
    assert.deepEqual(covers.books.map((item:any)=>item.id),coverIds.slice(0,2));
    assert.deepEqual(covers.books[0].authors,["Cover author"]);
    assert.equal(covers.hasMore,true);
    await assert.rejects(()=>rpc("assistant_list_missing_covers",[b,null,3]),/denied/);
    await assert.rejects(()=>rpc("assistant_list_missing_covers",[coverCollection,null,6]),/page size/);
    const fill = (copy:string,url="https://images.example.test/cover.jpg") => rpc("assistant_set_missing_cover",[coverCollection,copy,url,"https://publisher.example.test/book",JSON.stringify({imageVerified:true})]);
    assert.equal(await fill(coverIds[0]),true);
    assert.equal(await fill(coverIds[0],"https://images.example.test/replacement.jpg"),false,"never overwrite a concurrent cover");
    await db.exec("reset role");
    const storedCover = (await db.query<{cover_url:string;reading_status:string;edition_id:string|null;cover_status:string}>("select cover_url,reading_status,edition_id,cover_status from public.copies where id=$1",[coverIds[0]])).rows[0];
    assert.equal(storedCover.cover_url,"https://images.example.test/cover.jpg");
    assert.equal(storedCover.reading_status,"radar"); assert.equal(storedCover.edition_id,null);
    assert.equal(storedCover.cover_status,"completed");
    assert.equal((await db.query("select id from public.audit_events where copy_id=$1 and action='update_cover'",[coverIds[0]])).rows.length,1);
    assert.equal((await db.query("select copy_id from public.copy_cover_selections where copy_id=$1",[coverIds[0]])).rows.length,1);
    await claims(alice,true);
    assert.deepEqual((await rpc("assistant_list_missing_covers",[coverCollection,coverIds[1],2])).books.map((item:any)=>item.id),[coverIds[2]],"filling covers does not skip later IDs");
    for (const url of ["http://images.example.test/cover.jpg","https://127.0.0.1/private","https://10.0.0.1/private"]) await assert.rejects(()=>fill(coverIds[1],url),/Invalid cover URL/);
    await assert.rejects(()=>fill(secondOwner.copyId),/not found/);
    assert.equal(await rpc("assistant_set_missing_cover",[a,copyId,"https://images.example.test/cover.jpg",null,"{}"]),false,"owner-uploaded covers are preserved");
    // Two-step import persists metadata without a cover or fictional search notes.
    const metadataOnly = await rpc("assistant_create_collection",["Two-step import",null,JSON.stringify({schemaVersion:"mylibrary.shelfie.v1",books:[{
      position:1,title:"Metadata before covers",authors:["Metadata Author"],categories:["Fiction"],language:"en",confidence:.9
    }]})]);
    const missingAfterImport = await rpc("assistant_list_missing_covers",[metadataOnly.collectionId,null,5]);
    assert.equal(missingAfterImport.books.length,1);
    const newBookId = missingAfterImport.books[0].id;
    const readMetadata = async () => {
      await db.exec("reset role");
      const row = (await db.query<{cover_url:string|null;categories:string[];title:string;author:string}>("select c.cover_url,c.categories,w.title,w.author from public.copies c join public.works w on w.id=c.work_id where c.id=$1",[newBookId])).rows[0];
      await claims(alice,true);
      return row;
    };
    const beforeCover = await readMetadata();
    assert.equal(beforeCover.cover_url,null);assert.equal(beforeCover.title,"Metadata before covers");
    assert.deepEqual(beforeCover.categories,["Fiction"]);
    assert.equal(await rpc("assistant_set_missing_cover",[metadataOnly.collectionId,newBookId,"https://images.example.test/client-found.jpg",null,JSON.stringify({providedBy:"client",backendSearchPerformed:false})]),true);
    assert.deepEqual(await readMetadata(),{...beforeCover,cover_url:"https://images.example.test/client-found.jpg"});
    assert.equal((await rpc("assistant_list_missing_covers",[metadataOnly.collectionId,null,5])).books.length,0);
    // Gemini photo imports queue only their own missing covers and persist leases.
    const geminiImport = await rpc("assistant_create_collection",["Gemini test",null,JSON.stringify({schemaVersion:"mylibrary.shelfie.v1",books:[1,2,3].map(position=>({position,title:`Gemini book ${position}`,authors:["Author"],categories:["Fiction"],confidence:.9}))})]);
    await assert.rejects(()=>rpc("prepare_gemini_cover_jobs",[geminiImport.importId]),/Browser/);
    await claims(alice);
    await rpc("prepare_gemini_cover_jobs",[geminiImport.importId]);
    await rpc("prepare_gemini_cover_jobs",[geminiImport.importId]);
    assert.equal((await db.query("select id from public.gemini_cover_jobs where import_id=$1",[geminiImport.importId])).rows.length,3,"preparing a queue is idempotent");
    const browserGeminiImport=await rpc("import_gemini_books",[geminiImport.collectionId,"dddddddd-dddd-4ddd-8ddd-dddddddddddd",JSON.stringify({schemaVersion:"mylibrary.shelfie.v1",books:[{position:1,title:"Browser Gemini import",authors:["Author"],categories:["Fiction"],confidence:.9}]})]);
    const reservedJob=(await db.query<{copy_id:string}>("select copy_id from public.gemini_cover_jobs where import_id=$1",[browserGeminiImport.importId])).rows[0];
    assert.ok(reservedJob,"browser photo imports atomically prepare cover tasks");
    await db.exec("reset role");
    assert.equal((await db.query<{cover_status:string}>("select cover_status from public.copies where id=$1",[reservedJob.copy_id])).rows[0].cover_status,"cover_not_found","legacy resolver must not race Gemini searches");
    await claims(alice);
    const firstTask=await rpc("claim_gemini_cover_job",[geminiImport.importId]);
    const secondTask=await rpc("claim_gemini_cover_job",[geminiImport.importId]);
    assert.notEqual(firstTask.id,secondTask.id,"concurrent claims never share a book");
    await assert.rejects(()=>rpc("finish_gemini_cover_job",[firstTask.id,secondTask.lease,"{}"]),/lease/);
    const finishedGemini=await rpc("finish_gemini_cover_job",[firstTask.id,firstTask.lease,JSON.stringify({coverUrl:"https://images.example.test/gemini.jpg",notes:"Verified visually",queries:["title author"],sources:[]})]);
    assert.equal(finishedGemini,"found");
    assert.equal(await rpc("finish_gemini_cover_job",[secondTask.id,secondTask.lease,JSON.stringify({coverUrl:null,notes:"No suitable image",queries:["title author"]})]),"not_found");
    await assert.rejects(()=>rpc("finish_gemini_cover_job",[firstTask.id,firstTask.lease,"{}"]),/lease/);
    const thirdTask=await rpc("claim_gemini_cover_job",[geminiImport.importId]);
    assert.equal(await rpc("finish_gemini_cover_job",[thirdTask.id,thirdTask.lease,JSON.stringify({coverUrl:null,error:"Provider rate limited"})]),"failed");
    assert.equal(await rpc("claim_gemini_cover_job",[geminiImport.importId]),null);
    await rpc("retry_gemini_cover_jobs",[geminiImport.importId]);
    const retryTask=await rpc("claim_gemini_cover_job",[geminiImport.importId]);
    assert.notEqual(retryTask.lease,firstTask.lease);
    await claims(bob);
    assert.equal((await db.query("select id from public.gemini_cover_jobs where import_id=$1",[geminiImport.importId])).rows.length,0);
    await assert.rejects(()=>rpc("prepare_gemini_cover_jobs",[geminiImport.importId]),/not found/);
    await assert.rejects(()=>rpc("claim_gemini_cover_job",[geminiImport.importId]),/ownership/);
    await assert.rejects(()=>rpc("finish_gemini_cover_job",[retryTask.id,retryTask.lease,"{}"]),/lease/);
    await claims(alice);
    await claims(alice);
    await rpc("set_assistant_connection",["assistant",false]);
    await claims(alice,true);
    await assert.rejects(()=>rpc("assistant_list_missing_covers",[coverCollection,null,3]),/denied/);
    await assert.rejects(()=>fill(coverIds[1]),/denied/);
    await claims(bob,true);
    await assert.rejects(()=>rpc("assistant_list_missing_covers",[coverCollection,null,3]),/denied/);
    await assert.rejects(()=>fill(coverIds[1]),/denied/);
    await db.exec("reset role; set role anon");
    await assert.rejects(()=>rpc("assistant_list_missing_covers",[coverCollection,null,3]),/permission denied/);
    await assert.rejects(()=>fill(coverIds[1]),/permission denied/);
    // Loans attach to one physical copy, while contacts remain owner-private.
    await claims(alice);
    const beforeLoan = (await db.query("select * from public.copies where id=$1",[scanned.copyId])).rows;
    const setLoan = (status:string,name:string|null=null) => rpc("set_owned_book_loan",[a,scanned.legacyId,status,name]);
    const loans = async () => (await db.query<{status:string;person_name:string|null}>("select status,person_name from public.book_loans where copy_id=$1",[scanned.copyId])).rows;
    await setLoan("loaned_out","  Alex  ");
    assert.deepEqual(await loans(),[{status:"loaned_out",person_name:"Alex"}]);
    await setLoan("loaned_in","Dana");
    assert.deepEqual(await loans(),[{status:"loaned_in",person_name:"Dana"}]);
    await setLoan("loaned_in","   ");
    assert.deepEqual(await loans(),[{status:"loaned_in",person_name:null}],"contact name is optional");
    await setLoan("loaned_out","Private contact");
    await assert.rejects(()=>setLoan("invalid","Bad"),/Invalid loan status/);
    await assert.rejects(()=>setLoan("loaned_in","x".repeat(121)),/too long/);
    await assert.rejects(()=>rpc("set_owned_book_loan",[a,secondOwner.legacyId,"loaned_out","Wrong book"]),/ownership/);
    await assert.rejects(()=>rpc("set_owned_book_loan",[b,scanned.legacyId,"loaned_out","Wrong collection"]),/ownership/);
    await assert.rejects(()=>db.query("update public.book_loans set person_name='Bypass' where copy_id=$1",[scanned.copyId]),/permission denied/);
    assert.deepEqual((await db.query("select * from public.copies where id=$1",[scanned.copyId])).rows,beforeLoan,"loan changes never change reading status, metadata, ISBN or cover");
    await claims(bob);
    assert.deepEqual(await loans(),[],"another collection owner cannot read private contacts");
    await assert.rejects(()=>setLoan("none"),/ownership/);
    await claims(alice,true);
    assert.deepEqual(await loans(),[],"OAuth clients cannot read loan contacts");
    await assert.rejects(()=>setLoan("none"),/Browser/);
    await db.exec("reset role; set role anon");
    await assert.rejects(()=>loans(),/permission denied/);
    await assert.rejects(()=>setLoan("none"),/permission denied/);
    const publicFields = (await db.query("select * from public.public_catalogue limit 1")).fields.map(field=>field.name);
    assert.equal(publicFields.includes("person_name"),false,"contacts never enter public catalogue responses");
    await claims(alice);
    await setLoan("none","Stale name");
    assert.deepEqual(await loans(),[],"returning a book deletes its loan and contact");
    await setLoan("none");
    await setLoan("loaned_out","Delete with book");
    await db.exec("reset role");
    await db.query("delete from public.copies where id=$1",[scanned.copyId]);
    assert.deepEqual(await loans(),[],"deleting a book cleans up its loan");
    // Tags survive every import path; old singular clients remain compatible.
    await claims(alice); await rpc("set_assistant_connection",["assistant",true]);
    await claims(alice,true);
    const taggedPayload={schemaVersion:"mylibrary.shelfie.v1",books:[{position:1,title:"Tagged book",authors:["Author"],confidence:1,categories:[" fiction ","sci-fi","Fiction","children's books"],coverUrl:"https://images.example.test/book.jpg"}]};
    const taggedCollection=await rpc("assistant_create_collection",["Tagged books",null,taggedPayload]);
    const taggedList=await rpc("assistant_list_collection_books",[taggedCollection.collectionId,100,0]);
    assert.deepEqual(taggedList.books[0].categories,["Fiction","Science Fiction","Children's Books"]);
    for(const invalid of [null,[""],["x".repeat(81)],Array(9).fill("Fantasy"),["Fantasy",3]]) {
      await assert.rejects(()=>rpc("assistant_create_collection",["Invalid tags",null,{...taggedPayload,books:[{...taggedPayload.books[0],categories:invalid}]}]),/categor/i);
    }
    await db.exec("reset role");
    assert.equal((await db.query("select id from public.collections where name='Invalid tags'")).rows.length,0,"invalid tags roll back the whole collection/import");
    const tagCopy=(await db.query<{id:string;category:string}>("select id,category from public.copies where collection_id=$1",[taggedCollection.collectionId])).rows[0];
    assert.equal(tagCopy.category,"Fiction");
    await db.query("update public.copies set categories=array[' fantasy ','FANTASY','rpg'] where id=$1",[tagCopy.id]);
    assert.deepEqual((await db.query<{categories:string[]}>("select categories from public.copies where id=$1",[tagCopy.id])).rows[0].categories,["Fantasy","Tabletop Roleplaying"]);
    // A later cover/evidence update must not reapply the older observation's tags.
    await db.query("update public.book_observations set raw_payload=raw_payload||'{\"coverResolution\":\"checked\"}' where copy_id=$1",[tagCopy.id]);
    assert.deepEqual((await db.query<{categories:string[]}>("select categories from public.copies where id=$1",[tagCopy.id])).rows[0].categories,["Fantasy","Tabletop Roleplaying"]);
    await db.exec("set role anon");
    assert.deepEqual((await db.query<{categories:string[]}>("select categories from public.public_catalogue where legacy_id=$1",[taggedList.books[0].id])).rows[0].categories,["Fantasy","Tabletop Roleplaying"]);
    await assert.rejects(()=>db.query("update public.copies set categories=array['Horror'] where id=$1",[tagCopy.id]),/permission denied/);
  } finally { await db.close(); }
});
