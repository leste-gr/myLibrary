import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mapWithConcurrency } from "./isbn-matcher";

export type MissingCoverBook = { id: string; legacyId: string; title: string; authors: string[];
  language: string; publisher: string | null; series?: string | null; volume?: string | null };
export type MissingCoverPage = { collectionId: string; slug: string; totalMissing: number; books: MissingCoverBook[]; hasMore: boolean; nextCursor: string | null };

// URL syntax only: the client finds and verifies the image. No network lookup,
// image download, search provider or backend cover resolver runs here.
export const publicCoverUrlSchema = z.string().trim().min(1).max(2048).refine(raw => {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && /^[a-z0-9.-]+$/i.test(host) && host.includes(".")
      && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.)/.test(host)
      && !/\.(local|localhost)$/.test(host) && !/\s/.test(raw);
  } catch { return false; }
}, "Use a direct public HTTPS cover-image URL.").transform(raw => new URL(raw).toString());
export const coverUpdatesSchema = z.array(z.object({
  bookId: z.string().uuid().describe("Exact book UUID returned by list_missing_covers, not its legacyId."),
  coverUrl: publicCoverUrlSchema.describe("Direct public HTTPS image URL found and verified by the client for this work and volume."),
}).strict()).min(1).max(50).refine(covers => new Set(covers.map(cover => cover.bookId)).size === covers.length,
  "Submit each bookId only once per batch.");
export type CoverUpdateInput = z.infer<typeof coverUpdatesSchema>[number];
export type CoverUpdateResult = { collectionId: string; slug: string; processed: number; updated: number; failed: number; skipped: number;
  results: { bookId: string; status: "updated" | "failed" | "skipped"; coverUrl: string | null; message: string | null }[] };

export async function listMissingCovers(supabase: SupabaseClient, collectionId: string, after: string | null = null, limit = 5): Promise<MissingCoverPage> {
  const { data, error } = await supabase.rpc("assistant_list_missing_covers", {
    target_collection_id: collectionId, after_id: after, page_limit: limit,
  }).abortSignal(AbortSignal.timeout(8000));
  if (error) throw new Error(error.message);
  return { ...data, nextCursor: data.hasMore ? data.books.at(-1)?.id ?? null : null };
}

export async function updateCollectionCovers(supabase: SupabaseClient, collectionId: string, input: CoverUpdateInput[]): Promise<CoverUpdateResult> {
  // Validate the complete submitted batch before making any writes.
  const covers = coverUpdatesSchema.parse(input);
  const page = await listMissingCovers(supabase, collectionId, null, 1);
  const results = await mapWithConcurrency(covers,5,async ({ bookId, coverUrl }) => {
    try {
      // The RPC rechecks ownership, consent, collection membership and current
      // cover state atomically. It only persists the client-supplied metadata.
      const { data: saved, error } = await supabase.rpc("assistant_set_missing_cover", {
        target_collection_id: collectionId, target_copy_id: bookId, cover_url: coverUrl,
        source_page_url: null, search_evidence: { providedBy: "client", backendSearchPerformed: false },
      }).abortSignal(AbortSignal.timeout(8000));
      if (error) throw new Error(error.message);
      return { bookId, status: saved ? "updated" as const : "skipped" as const, coverUrl: saved ? coverUrl : null,
        message: saved ? null : "An existing cover or owner upload was preserved." };
    } catch (error) {
      return { bookId, status: "failed" as const, coverUrl: null,
        message: error instanceof Error ? error.message : "Could not save the submitted cover URL." };
    }
  });
  return { collectionId, slug: page.slug, processed: results.length,
    updated: results.filter(item => item.status === "updated").length,
    failed: results.filter(item => item.status === "failed").length,
    skipped: results.filter(item => item.status === "skipped").length, results };
}
