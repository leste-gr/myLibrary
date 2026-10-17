import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findBookIsbnCandidates } from "./book-isbn-search";
import type { RankedIsbnCandidate } from "./isbn-matcher";

function client() {
  const filters: unknown[] = [], saves: unknown[] = [];
  const supabase = {
    from(table: string) {
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) { filters.push([table, column, value]); return chain; },
        order() { return chain; }, limit() { return chain; },
        async single() { return { data: { publisher: "Publisher", language: "en", work: { title: "Current title", author: "Author", series: null }, edition: null }, error: null }; },
        async maybeSingle() { return { data: { raw_payload: { authors: ["Original author"], publicationYear: 2001 } }, error: null }; },
      }; return chain;
    },
    async rpc(name: string, args: unknown) { saves.push([name, args]); return { data: 2, error: null }; },
  } as unknown as SupabaseClient;
  return { supabase, filters, saves };
}

test("single-book Stage 2 uses shared ranking and only saves review results for that copy", async () => {
  const { supabase, filters, saves } = client();
  const candidates = [{ isbn13: "9780261102217", rank: 1 }, { isbn13: "9780140328721", rank: 2 }] as RankedIsbnCandidate[];
  const result = await findBookIsbnCandidates(supabase, "copy-id", async input => {
    assert.equal(input.title, "Current title");
    assert.deepEqual(input.authors, ["Original author"]);
    assert.equal(input.publicationYear, 2001);
    return { candidates, providerFailures: 0 };
  });
  assert.deepEqual(result, { count: 2, providerFailures: 0 });
  assert.deepEqual(filters, [["copies", "id", "copy-id"], ["book_observations", "copy_id", "copy-id"]]);
  assert.deepEqual(saves, [["save_book_isbn_search", { target_copy_id: "copy-id", candidates, provider_failures: 0 }]]);
});

test("a provider outage preserves previously saved candidates", async () => {
  const { supabase, saves } = client();
  await assert.rejects(() => findBookIsbnCandidates(supabase, "copy-id", async () => ({ candidates: [], providerFailures: 2 })), /providers are unavailable/);
  assert.equal(saves.length, 0);
});
