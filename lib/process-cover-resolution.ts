import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCandidateCovers } from "./candidate-cover-resolver";
import { resolveMetadataCover } from "./metadata-cover-resolver";
import { nextHourlyRetry } from "./ingestion-retry";

type BookCover = {
  id: string; cover_url: string | null; publisher: string | null; language: string | null; volume: string | null;
  edition: { isbn13: string | null } | null;
  work: { title: string; author: string; series: string | null };
};

async function finishBook(supabase: SupabaseClient, copyId: string, status: "completed" | "cover_not_found" | "failed", error?: string) {
  const { error: updateError } = await supabase.from("copies").update({
    cover_status: status, cover_error: error?.slice(0, 1000) ?? null,
    cover_completed_at: status === "failed" ? null : new Date().toISOString(),
    cover_next_retry_at: status === "failed" ? nextHourlyRetry() : null,
  }).eq("id", copyId).eq("cover_status", "processing");
  if (updateError) throw new Error(updateError.message);
}

async function resolveIsbn(supabase: SupabaseClient, siteUrl: string, book: BookCover, isbn: string) {
  const { data: job, error } = await supabase.from("cover_resolution_jobs").select("status").eq("isbn13", isbn).maybeSingle();
  if (error) throw new Error(error.message);
  if (job?.status === "missing") return false;
  let source: string;
  try {
    const response = await fetch(new URL(`/api/covers/${isbn}`, siteUrl), { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Cover endpoint returned ${response.status}.`);
    source = response.headers.get("x-cover-source") ?? "";
    const bytes = await response.arrayBuffer();
    if (source !== "placeholder" && (!new Set(["openlibrary", "google-books"]).has(source) || !response.headers.get("content-type")?.startsWith("image/") || !bytes.byteLength)) {
      throw new Error("Cover endpoint returned an unverified image.");
    }
  } catch (error) {
    const { error: jobError } = await supabase.from("cover_resolution_jobs").update({
      status: "failed", error: error instanceof Error ? error.message : "Cover lookup failed.",
      next_retry_at: nextHourlyRetry(), updated_at: new Date().toISOString(),
    }).eq("isbn13", isbn);
    if (jobError) throw new Error(jobError.message);
    throw error;
  }
  const { error: jobError } = await supabase.from("cover_resolution_jobs").update({
    status: source === "placeholder" ? "missing" : "completed", source, error: null,
    next_retry_at: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("isbn13", isbn);
  if (jobError) throw new Error(jobError.message);
  if (source === "placeholder") return false;
  const { data: attached, error: attachError } = await supabase.rpc("select_resolved_isbn_cover", { target_copy_id: book.id, target_isbn: isbn });
  if (attachError) throw new Error(attachError.message);
  if (!attached) throw new Error("Book edition changed during cover resolution.");
  return true;
}

// Atomic per-book claims prevent hourly and import-triggered workers overlapping.
export async function processCoverResolution(supabase: SupabaseClient, siteUrl: string, deadline = Date.now() + 240_000) {
  let isbnCovers = 0, candidateCovers = 0, metadataCovers = 0, coversNotFound = 0, failedCovers = 0;
  for (let processed = 0; processed < 100 && Date.now() < deadline; processed++) {
    const { data: copyId, error: claimError } = await supabase.rpc("claim_next_book_cover");
    if (claimError) throw new Error(claimError.message);
    if (!copyId) break;
    try {
      const { data, error } = await supabase.from("copies")
        .select("id,cover_url,publisher,language,volume,edition:editions(isbn13),work:works(title,author,series)")
        .eq("id", copyId).single();
      if (error || !data) throw new Error(error?.message ?? "Book not found.");
      const book = data as unknown as BookCover;
      if (book.cover_url) { await finishBook(supabase, book.id, "completed"); continue; }
      let found = false;
      if (book.edition?.isbn13) {
        found = await resolveIsbn(supabase, siteUrl, book, book.edition.isbn13);
        isbnCovers++;
      } else {
        const candidates = await resolveCandidateCovers(supabase, siteUrl, undefined, book.id);
        found = candidates.some(result => result.selected);
        if (found) candidateCovers++;
        if (!found) {
          found = await resolveMetadataCover(supabase, {
            copyId: book.id, title: book.work.title,
            authors: book.work.author.split(",").map(author => author.trim()).filter(Boolean),
            publisher: book.publisher, language: book.language, series: book.work.series, volume: book.volume,
          });
          if (found) metadataCovers++;
        }
      }
      await finishBook(supabase, book.id, found ? "completed" : "cover_not_found");
      if (!found) coversNotFound++;
    } catch (error) {
      await finishBook(supabase, copyId as string, "failed", error instanceof Error ? error.message : "Cover resolution failed.");
      failedCovers++;
    }
  }
  return { isbnCovers, candidateCovers, metadataCovers, coversNotFound, failedCovers, stage3Covers: isbnCovers + candidateCovers + metadataCovers };
}
