import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRadarBooks } from "./radar";

function database(count: number, fail = false) {
  const filters: [string, unknown][] = [], ranges: number[][] = [];
  const client = { from(table: string) {
    assert.equal(table, "copies");
    const query = {
      select(value: string) { assert.match(value, /collections!inner/); return query; },
      eq(key: string, value: unknown) { filters.push([key,value]); return query; },
      order() { return query; },
      async range(start: number, end: number) {
        ranges.push([start,end]);
        return { error: fail ? new Error("Database unavailable") : null,
          data: Array.from({ length: Math.min(200, Math.max(0,count-start)) }, (_,index) => ({
            id: `copy-${start+index}`, legacy_id: `book-${start+index}`, cover_url: null, cover_status: "cover_not_found",
            work: { title: `Book ${start+index}`, author: "Author" }, edition: null,
            collection: { slug: index%2 ? "private-collection" : "public-collection", name: "My collection", is_public: index%2 === 0 },
          })) };
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, filters, ranges };
}

test("radar reads all pages, scopes each request to its owner, and includes private collections", async () => {
  const db = database(405);
  const books = await getRadarBooks(db.client,"owner-id");
  assert.equal(books.length,405); assert.equal(new Set(books.map(book=>book.id)).size,405);
  assert.deepEqual(db.ranges,[[0,199],[200,399],[400,599]]);
  assert.equal(db.filters.filter(([key,value])=>key==="collection.owner_id"&&value==="owner-id").length,3);
  assert.equal(db.filters.filter(([key,value])=>key==="reading_status"&&value==="radar").length,3);
  assert.ok(!db.filters.some(([key])=>key.includes("is_public")));
  assert.ok(books.some(book=>book.collectionSlug==="private-collection"));
  assert.equal(books[0].cover,"/covers/cover-not-found.svg");
});

test("radar distinguishes an empty list from failure and requires an owner", async () => {
  assert.deepEqual(await getRadarBooks(database(0).client,"owner-id"),[]);
  await assert.rejects(getRadarBooks(database(0,true).client,"owner-id"),/Unable to load/);
  const db=database(1);
  await assert.rejects(getRadarBooks(db.client,""),/Authentication required/);
  assert.equal(db.ranges.length,0);
});
