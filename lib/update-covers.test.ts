import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateCollectionCovers, type MissingCoverBook } from "./update-covers";
import type { VerifiedCover } from "./online-cover-search";

const cover: VerifiedCover = { coverUrl: "https://images.example.test/book.jpg", sourcePageUrl: null, evidence: { imageVerified: true } };
const book = (id: string): MissingCoverBook => ({ id, legacyId: id, title: `Book ${id}`, authors: ["Author"], language: "en", publisher: null });
function database(ids: string[]) {
  const missing = new Set(ids);
  const saves: string[] = [];
  let deny = false, refreshFailure = false, lists = 0;
  const concurrent = new Set<string>();
  const client = { rpc(name: string, args: Record<string, any>) {
    return { abortSignal: async () => {
      if (deny) return { data: null, error: { message: "Assistant access denied." } };
      if (name === "assistant_list_missing_covers") {
        if (++lists > 1 && refreshFailure) return { data: null, error: { message: "Network failure" } };
        const candidates = [...missing].filter(id => !args.after_id || id > args.after_id).sort();
        return { data: { collectionId: "collection", slug: "books", totalMissing: missing.size,
          books: candidates.slice(0,args.page_limit).map(book), hasMore: candidates.length > args.page_limit }, error: null };
      }
      assert.equal(name, "assistant_set_missing_cover");
      saves.push(args.target_copy_id);
      missing.delete(args.target_copy_id);
      return { data: !concurrent.has(args.target_copy_id), error: null };
    } };
  } } as unknown as SupabaseClient;
  return { client, missing, saves, concurrent, deny: () => { deny = true; }, failRefresh: () => { refreshFailure = true; } };
}

test("cover batches use stable cursors while successful saves shrink the queue", async () => {
  const db = database(["1", "2", "3", "4", "5"]);
  const searched: string[] = [];
  const search = async (input: { copyId: string }) => { searched.push(input.copyId); return cover; };
  const first = await updateCollectionCovers(db.client,"collection",null,3,{ search });
  assert.equal(first.updated,3); assert.equal(first.remaining,2); assert.equal(first.hasMore,true); assert.equal(first.nextCursor,"3");
  const last = await updateCollectionCovers(db.client,"collection",first.nextCursor,3,{ search });
  assert.equal(last.updated,2); assert.equal(last.hasMore,false); assert.equal(last.remaining,0);
  assert.deepEqual(searched,["1","2","3","4","5"]);
});

test("misses, provider failures and concurrent covers are reported without endless retries", async () => {
  const db = database(["1","2","3","4"]); db.concurrent.add("3");
  const search = async (input: { copyId: string }) => {
    if (input.copyId === "1") return null;
    if (input.copyId === "2") throw new Error("Provider unavailable");
    return cover;
  };
  const first = await updateCollectionCovers(db.client,"collection",null,3,{ search });
  assert.equal(first.notFound,1); assert.equal(first.failed,1); assert.equal(first.skipped,1);
  assert.equal(first.results[1].message,"Provider unavailable");
  const last = await updateCollectionCovers(db.client,"collection",first.nextCursor,3,{ search });
  assert.equal(last.updated,1); assert.equal(last.hasMore,false); assert.equal(last.remaining,2);
  assert.deepEqual(db.saves,["3","4"]);
});

test("access is checked before searching and empty collections need no searches", async () => {
  const db = database(["1"]); db.deny();
  let searches = 0;
  const search = async () => { searches++; return cover; };
  await assert.rejects(() => updateCollectionCovers(db.client,"collection",null,3,{ search }),/denied/);
  assert.equal(searches,0); assert.deepEqual(db.saves,[]);
  const empty = await updateCollectionCovers(database([]).client,"collection",null,3,{ search });
  assert.equal(empty.processed,0); assert.equal(empty.hasMore,false); assert.equal(searches,0);
});

test("timed-out searches cannot save later and committed results survive a refresh failure", async () => {
  const db = database(["1"]);
  let finish!: (value: VerifiedCover) => void;
  const search = () => new Promise<VerifiedCover>(resolve => { finish = resolve; });
  // Keep the test process alive while AbortSignal.timeout's unref'ed timer fires.
  const hold = setTimeout(() => {},1000);
  try {
    const result = await updateCollectionCovers(db.client,"collection",null,3,{ search, timeoutMs: 5 });
    assert.equal(result.failed,1); assert.match(result.results[0].message!,/timed out/);
    finish(cover); await new Promise(resolve => setTimeout(resolve,10));
    assert.deepEqual(db.saves,[]);
  } finally { clearTimeout(hold); }
  const saved = database(["1","2"]); saved.failRefresh();
  const result = await updateCollectionCovers(saved.client,"collection",null,1,{ search: async () => cover });
  assert.equal(result.updated,1); assert.equal(result.hasMore,true); assert.equal(result.nextCursor,"1");
  assert.match(result.warning!,/estimate/); assert.equal(result.remaining,1);
});
