import assert from "node:assert/strict";
import test from "node:test";
import { getPublicCatalogue, getPublicCollection, getPublicCollections } from "./catalogue";

test("catalogue uses only Supabase and distinguishes empty results from failures", async (t) => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  t.after(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  await assert.rejects(getPublicCollections(), /Supabase is not configured/);
  await assert.rejects(getPublicCatalogue("lefteris"), /Supabase is not configured/);

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
  let payload: unknown = [];
  let status = 200;
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    requests.push(input instanceof Request ? input.url : String(input));
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  });
  assert.deepEqual(await getPublicCollections(), []);
  assert.deepEqual(await getPublicCatalogue("lefteris"), []);
  assert.equal(await getPublicCollection("lefteris"), null);

  payload = [{ id: "db-id", slug: "new", name: "New library", description: null, book_count: 1, author_count: 1 }];
  assert.deepEqual(await getPublicCollections(), [{ id: "db-id", slug: "new", name: "New library", description: null, bookCount: 1, authorCount: 1 }]);
  await getPublicCollections(["db-id"]);
  assert.equal(new URL(requests.at(-1)!).searchParams.get("id"), 'in.(db-id)');
  const requestCount = requests.length;
  assert.deepEqual(await getPublicCollections([]), []);
  assert.equal(requests.length, requestCount, "an owner without collections must never fall back to all collections");
  payload = [{ legacy_id: "db-book", title: "Database book", author: "Author", contributors: null, series: null, subseries: null, volume: null, language: "en", category: "Fiction", publisher: null, notes: null, cover_url: "https://example.test/cover.jpg", cover_source: "assistant-supplied", isbn13: null }];
  const books = await getPublicCatalogue("new");
  assert.equal(books.length, 1);
  assert.equal(books[0].id, "db-book");
  assert.equal(books[0].cover, "https://example.test/cover.jpg");
  assert.ok(requests.at(-1)?.includes("collection_slug=eq.new"));

  status = 503;
  payload = { message: "Database unavailable" };
  await assert.rejects(getPublicCollections(), /Unable to load public collections/);
  await assert.rejects(getPublicCatalogue("lefteris"), /Unable to load public catalogue/);
});
