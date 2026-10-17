import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processCoverResolution } from "./process-cover-resolution";

type Book = { id: string; cover_url: string | null; cover_status: string; edition: { isbn13: string } | null; work: { title: string; author: string; series: null }; [key: string]: unknown };
function database(books: Book[]) {
  const jobs = new Map<string, Record<string, unknown>>();
  const supabase = {
    async rpc(name: string, args?: { target_copy_id: string }) {
      if (name === "claim_next_book_cover") {
        const book = books.find(book => book.cover_status === "pending");
        if (book) book.cover_status = "processing";
        return { data: book?.id ?? null, error: null };
      }
      if (name === "select_resolved_isbn_cover") {
        const book = books.find(book => book.id === args?.target_copy_id)!;
        book.cover_url = "/api/cover-assets/selected";
        book.cover_status = "completed";
        return { data: true, error: null };
      }
      throw new Error("Unexpected RPC: " + name);
    },
    from(table: string) {
      let update: Record<string, unknown> | undefined;
      const filters: Record<string, unknown> = {};
      let single = false;
      const query = {
        select() { return query; },
        update(value: Record<string, unknown>) { update = value; return query; },
        delete() { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        is() { return query; }, in() { return query; }, not() { return query; },
        single() { single = true; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve: (value: unknown) => unknown) {
          let data: unknown = single ? null : [];
          if (table === "copies") {
            const matches = books.filter(book => Object.entries(filters).every(([key, value]) => book[key] === value));
            if (update) matches.forEach(book => Object.assign(book, update));
            data = single ? matches[0] : matches;
          }
          if (table === "cover_resolution_jobs") {
            if (update) jobs.set(filters.isbn13 as string, update);
            data = jobs.get(filters.isbn13 as string) ?? null;
          }
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { supabase, jobs };
}
function book(id: string, isbn = true): Book {
  return { id, cover_url: null, cover_status: "pending", publisher: null, language: "en", volume: null,
    edition: isbn ? { isbn13: "9780140328721" } : null, work: { title: "A distinctive book title", author: "Author", series: null } };
}

test("successful ISBN lookup completes the book and attaches its cover", async () => {
  const books = [book("success")]; const { supabase, jobs } = database(books);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1]), { headers: { "x-cover-source": "openlibrary", "content-type": "image/jpeg" } });
  try {
    const result = await processCoverResolution(supabase, "https://library.test");
    assert.equal(result.isbnCovers, 1);
    assert.equal(books[0].cover_status, "completed");
    assert.ok(books[0].cover_url);
    assert.equal(jobs.get("9780140328721")?.status, "completed");
  } finally { globalThis.fetch = originalFetch; }
});

test("genuine ISBN miss is terminal and is skipped on the next run", async () => {
  const books = [book("missing")]; const { supabase } = database(books);
  let requests = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests++; return new Response("<svg/>", { headers: { "x-cover-source": "placeholder" } }); };
  try {
    assert.equal((await processCoverResolution(supabase, "https://library.test")).coversNotFound, 1);
    assert.equal(books[0].cover_status, "cover_not_found");
    await processCoverResolution(supabase, "https://library.test");
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("provider outages stay retryable and do not stop the next book", async () => {
  const books = [book("failure"), book("next")]; const { supabase } = database(books);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    const result = await processCoverResolution(supabase, "https://library.test");
    assert.equal(result.failedCovers, 2);
    assert.equal(books[0].cover_status, "failed");
    assert.ok(Date.parse(books[0].cover_next_retry_at as string) > Date.now());
    assert.equal(books[1].cover_status, "failed");
  } finally { globalThis.fetch = originalFetch; }
});

test("metadata search with healthy empty providers becomes cover_not_found", async () => {
  const books = [book("metadata", false)]; const { supabase } = database(books);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { headers: { "content-type": "application/json" } });
  try {
    const result = await processCoverResolution(supabase, "https://library.test");
    assert.equal(result.coversNotFound, 1);
    assert.equal(books[0].cover_status, "cover_not_found");
  } finally { globalThis.fetch = originalFetch; }
});

test("an incomplete metadata web search remains failed and retryable", async () => {
  const books = [book("metadata-outage", false)]; const { supabase } = database(books);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => /bing\.com|duckduckgo\.com/.test(String(url))
    ? new Response("unavailable", { status: 503 })
    : new Response("{}", { headers: { "content-type": "application/json" } });
  try {
    const result = await processCoverResolution(supabase, "https://library.test");
    assert.equal(result.failedCovers, 1);
    assert.equal(result.coversNotFound, 0);
    assert.equal(books[0].cover_status, "failed");
  } finally { globalThis.fetch = originalFetch; }
});
