import type { SupabaseClient } from "@supabase/supabase-js";
import { mapWithConcurrency } from "./isbn-matcher";
import { findVerifiedCover, type VerifiedCover } from "./online-cover-search";
import type { MetadataCoverInput } from "./metadata-cover-resolver";

export type MissingCoverBook = Omit<MetadataCoverInput,"copyId"> & { id: string; legacyId: string };
export type MissingCoverPage = { collectionId: string; slug: string; totalMissing: number; books: MissingCoverBook[]; hasMore: boolean };
export type CoverUpdateItem = { id: string; legacyId: string; title: string; status: "updated" | "not_found" | "failed" | "skipped"; coverUrl: string | null; message: string | null };
export type CoverUpdateResult = { collectionId: string; slug: string; processed: number; updated: number; notFound: number;
  failed: number; skipped: number; remaining: number; hasMore: boolean; nextCursor: string | null; warning: string | null; results: CoverUpdateItem[] };

// Also bound searches that are stalled in DNS or a third-party library. Search
// promises never write data; only this awaited caller can perform a conditional save.
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const aborted = new Promise<never>((_,reject) => { abort = () => reject(new Error("Cover search timed out.")); signal.addEventListener("abort",abort,{once:true}); });
  try { return await Promise.race([promise,aborted]); }
  finally { signal.removeEventListener("abort",abort); }
}

export async function updateCollectionCovers(supabase: SupabaseClient, collectionId: string, after: string | null = null, limit = 3,
  options: { search?: (input: MetadataCoverInput, signal: AbortSignal) => Promise<VerifiedCover | null>; timeoutMs?: number } = {}): Promise<CoverUpdateResult> {
  async function list(cursor: string | null, pageLimit: number): Promise<MissingCoverPage> {
    const { data, error } = await supabase.rpc("assistant_list_missing_covers", {
      target_collection_id: collectionId, after_id: cursor, page_limit: pageLimit,
    }).abortSignal(AbortSignal.timeout(8000));
    if (error) throw new Error(error.message);
    return data;
  }
  // This RPC verifies connection consent and ownership before any online search.
  const page = await list(after,limit);
  const results = await mapWithConcurrency(page.books,3,async (book): Promise<CoverUpdateItem> => {
    const item = { id: book.id, legacyId: book.legacyId, title: book.title, coverUrl: null, message: null };
    try {
      const signal = AbortSignal.timeout(options.timeoutMs ?? 35_000);
      const cover = await abortable((options.search ?? findVerifiedCover)({ ...book, copyId: book.id,
        authors: book.authors.filter(author => typeof author === "string").map(author => author.trim()).filter(Boolean) },signal),signal);
      if (!cover) return { ...item,status: "not_found",message: "No suitable verified cover was found." };
      signal.throwIfAborted();
      const { data: saved, error } = await supabase.rpc("assistant_set_missing_cover", {
        target_collection_id: collectionId, target_copy_id: book.id, cover_url: cover.coverUrl,
        source_page_url: cover.sourcePageUrl, search_evidence: cover.evidence,
      }).abortSignal(AbortSignal.timeout(8000));
      if (error) throw new Error(error.message);
      return saved ? { ...item,status: "updated",coverUrl: cover.coverUrl }
        : { ...item,status: "skipped",message: "A cover was already saved by another request; it was preserved." };
    } catch (error) {
      return { ...item,status: "failed",message: error instanceof Error ? error.message : "Cover search or save failed." };
    }
  });
  const cursor = page.books.at(-1)?.id ?? after;
  // A transient refresh failure must not hide writes that have already committed.
  let remaining = { totalMissing: page.totalMissing - results.filter(item => ["updated", "skipped"].includes(item.status)).length,
    books: [] as MissingCoverBook[] };
  let hasMore = page.hasMore;
  let warning: string | null = null;
  try { remaining = await list(cursor,1); hasMore = remaining.books.length > 0; }
  catch { warning = "Could not refresh the remaining count; it is an estimate. Confirmed per-book results are retained. Continue with nextCursor when hasMore is true."; }
  return { collectionId,slug: page.slug,processed: results.length,
    updated: results.filter(item=>item.status==="updated").length,
    notFound: results.filter(item=>item.status==="not_found").length,
    failed: results.filter(item=>item.status==="failed").length,
    skipped: results.filter(item=>item.status==="skipped").length,
    remaining: Math.max(0,remaining.totalMissing),warning,hasMore,nextCursor: hasMore ? cursor : null,results };
}
