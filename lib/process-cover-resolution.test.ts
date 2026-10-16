import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processCoverResolution } from "./process-cover-resolution";

test("Stage 3 resolves ISBN jobs before candidate and metadata discovery", async () => {
  const events: string[] = [];
  let claimed = false;
  const supabase = {
    async rpc(name: string) {
      events.push(name);
      if (name === "claim_next_cover_resolution" && !claimed) {
        claimed = true;
        return { data: [{ isbn13: "9780140328721", attempts: 1 }], error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      events.push(table);
      const query = {
        select() { return query; },
        update(value: { status: string }) { events.push(value.status); return query; },
        eq() { return query; },
        in(column: string, values: string[]) {
          assert.equal(column, "status");
          assert.deepEqual(values, ["matched", "unresolved"]);
          return query;
        },
        not() { return query; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    events.push("fetch-cover");
    return new Response(new Uint8Array([1]), { headers: { "x-cover-source": "openlibrary", "content-type": "image/jpeg" } });
  };
  try {
    assert.deepEqual(await processCoverResolution(supabase, "https://library.test"), {
      isbnCovers: 1, candidateCovers: 0, metadataCovers: 0, stage3Covers: 1,
    });
    assert.deepEqual(events, [
      "claim_next_cover_resolution", "fetch-cover", "cover_resolution_jobs", "completed",
      "claim_next_cover_resolution", "attach_resolved_isbn_covers",
      "book_observations", "book_observations",
    ]);
  } finally { globalThis.fetch = originalFetch; }
});
