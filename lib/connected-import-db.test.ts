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
    await assert.rejects(() => rpc("confirm_shelfie_draft", [draft.draftId, { ...payload, books: [book, { ...book, position: 2, title: "" }] }]), /requires a title/);
    assert.equal((await db.query("select * from public.copies")).rows.length, 0, "a failed import rolls back all books");
    const imported = await rpc("confirm_shelfie_draft", [draft.draftId, payload]);
    assert.equal(imported.imported, 1);
    assert.deepEqual(await rpc("confirm_shelfie_draft", [draft.draftId, payload]), imported);
    assert.equal((await db.query("select * from public.copies")).rows.length, 1);
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
  } finally { await db.close(); }
});
