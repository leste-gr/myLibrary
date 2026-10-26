import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listMissingCovers, updateCollectionCovers } from "./update-covers";

const id = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const coverUrl = "https://images.example.test/book.jpg";
function database() {
  const calls: { name: string; args: Record<string, any> }[] = [];
  let deny = false;
  const client = { rpc(name: string, args: Record<string, any>) {
    calls.push({ name, args });
    return { abortSignal: async () => {
      if (deny) return { data: null, error: { message: "Assistant access denied." } };
      if (name === "assistant_list_missing_covers") return { data: {
        collectionId: id, slug: "books", totalMissing: 2, hasMore: !args.after_id,
        books: [{ id: args.after_id ? second : id, legacyId: "B1", title: "Book", authors: ["Author"], language: "en", publisher: null }],
      }, error: null };
      assert.equal(name, "assistant_set_missing_cover");
      if (args.target_copy_id === second) return { data: false, error: null };
      return { data: true, error: null };
    } };
  } } as unknown as SupabaseClient;
  return { client, calls, deny: () => { deny = true; } };
}

test("missing cover listing returns stable cursors and performs no writes", async () => {
  const db = database();
  const page = await listMissingCovers(db.client, id);
  assert.equal(page.nextCursor,id);
  assert.equal((await listMissingCovers(db.client,id,page.nextCursor)).nextCursor,null);
  assert.deepEqual(db.calls.map(call => call.name),["assistant_list_missing_covers","assistant_list_missing_covers"]);
});

test("saves exactly the client-supplied URLs without fetching or searching, preserving concurrent covers", async () => {
  const db = database();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("No external requests are allowed."); };
  try {
    const result = await updateCollectionCovers(db.client,id,[{ bookId:id,coverUrl },{ bookId:second,coverUrl }]);
    assert.equal(result.updated,1);assert.equal(result.skipped,1);assert.equal(result.failed,0);
    assert.equal(result.results[0].coverUrl,coverUrl);
    assert.equal(result.results[1].coverUrl,null);
    const saves = db.calls.filter(call => call.name === "assistant_set_missing_cover");
    assert.deepEqual(saves.map(call => call.args.cover_url),[coverUrl,coverUrl]);
    assert.deepEqual(saves[0].args.search_evidence,{ providedBy:"client",backendSearchPerformed:false });
  } finally { globalThis.fetch = originalFetch; }
});

test("invalid or duplicate submissions reject the complete batch before any database calls", async () => {
  for (const invalid of [[],[{bookId:id,coverUrl},{bookId:second,coverUrl:"http://images.example.test/no.jpg"}],
    [{bookId:id,coverUrl},{bookId:id,coverUrl}], [{bookId:id,coverUrl:"https://127.0.0.1/no.jpg"}],
    [{bookId:id,coverUrl:"https://2130706433/no.jpg"}], [{bookId:id,coverUrl:"https://user:password@images.example.test/no.jpg"}]]) {
    const db = database();
    await assert.rejects(() => updateCollectionCovers(db.client,id,invalid));
    assert.deepEqual(db.calls,[]);
  }
});

test("access is checked before saving and per-book save errors are reported honestly", async () => {
  const db = database(); db.deny();
  await assert.rejects(() => updateCollectionCovers(db.client,id,[{bookId:id,coverUrl}]),/denied/);
  assert.equal(db.calls.length,1);
  const client = { rpc(name: string) { return { abortSignal: async () => name === "assistant_list_missing_covers"
    ? {data:{slug:"books",books:[],hasMore:false},error:null}
    : {data:null,error:{message:"Book not found in this collection."}} }; } } as unknown as SupabaseClient;
  const result = await updateCollectionCovers(client,id,[{bookId:id,coverUrl}]);
  assert.equal(result.failed,1);assert.equal(result.updated,0);assert.match(result.results[0].message!,/not found/);
});
