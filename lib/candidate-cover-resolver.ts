import type { SupabaseClient } from "@supabase/supabase-js";
import { mapWithConcurrency } from "./isbn-matcher";

const MIN_REPRESENTATIVE_WORK_CONFIDENCE = 0.85;
const VERIFIED_SOURCES = new Set(["openlibrary", "google-books"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type CandidateRow = {
  id: string;
  copy_id: string;
  isbn13: string;
  work_confidence: number | null;
};

export type CandidateCoverResult = {
  candidateId: string;
  copyId: string;
  isbn13: string;
  selected: boolean;
  source: string | null;
};

export function representativeCoverConfidence(workConfidence: number) {
  return Number(Math.min(1, Math.max(0, workConfidence) * 0.9 + 0.1).toFixed(4));
}

async function validImage(response: Response) {
  const type = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || !type.startsWith("image/") || type === "image/svg+xml" || declaredLength > MAX_IMAGE_BYTES) return false;
  const bytes = await response.arrayBuffer();
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_IMAGE_BYTES;
}

export async function probeCandidateCover(siteUrl: string, isbn13: string, fetcher: typeof fetch = fetch, retryFailures = false) {
  const endpoint = new URL(`/api/covers/${isbn13}`, siteUrl);
  try {
    const response = await fetcher(endpoint, { redirect: "manual", signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (retryFailures && !response.ok && response.status !== 404 && response.status !== 410) throw new Error(`Cover provider returned ${response.status}.`);
    const source = response.headers.get("x-cover-source");
    if (!source || !VERIFIED_SOURCES.has(source)) return null;
    return await validImage(response) ? source : null;
  } catch (error) {
    if (retryFailures) throw error;
    return null;
  }
}

async function candidateRows(supabase: SupabaseClient, importId?: string, copyId?: string) {
  let observationsQuery = supabase.from("book_observations").select("copy_id").in("status", ["matched", "unresolved"]).not("copy_id", "is", null);
  if (importId) observationsQuery = observationsQuery.eq("manual_genai_import_id", importId);
  if (copyId) observationsQuery = observationsQuery.eq("copy_id", copyId);
  const { data: observations, error } = await observationsQuery;
  if (error) throw new Error(error.message);
  const copyIds = [...new Set((observations ?? []).map((row) => row.copy_id as string))];
  if (!copyIds.length) return [];

  let copiesQuery = supabase.from("copies").select("id").is("edition_id", null).is("cover_url", null).eq("edition_verification_state", "unresolved").in("cover_status", ["pending", "processing", "failed"]);
  if (copyIds) copiesQuery = copiesQuery.in("id", copyIds);
  const { data: copies, error: copiesError } = await copiesQuery;
  if (copiesError) throw new Error(copiesError.message);
  const unresolvedIds = (copies ?? []).map((copy) => copy.id as string);
  if (!unresolvedIds.length) return [];

  const { data: candidates, error: candidatesError } = await supabase
    .from("edition_candidates")
    .select("id,copy_id,isbn13,work_confidence")
    .in("copy_id", unresolvedIds)
    .eq("rank", 1)
    .neq("selection_state", "owner_rejected")
    .gte("work_confidence", MIN_REPRESENTATIVE_WORK_CONFIDENCE);
  if (candidatesError) throw new Error(candidatesError.message);
  return (candidates ?? []) as CandidateRow[];
}

export async function resolveCandidateCovers(supabase: SupabaseClient, siteUrl: string, importId?: string, copyId?: string) {
  const candidates = await candidateRows(supabase, importId, copyId);
  return mapWithConcurrency(candidates, 3, async (candidate): Promise<CandidateCoverResult> => {
    const source = await probeCandidateCover(siteUrl, candidate.isbn13, fetch, true);
    if (!source) return { candidateId: candidate.id, copyId: candidate.copy_id, isbn13: candidate.isbn13, selected: false, source: null };
    const coverConfidence = representativeCoverConfidence(Number(candidate.work_confidence ?? 0));
    const { error } = await supabase.rpc("select_candidate_representative_cover", {
      target_candidate_id: candidate.id,
      target_cover_confidence: coverConfidence,
      detected_source: source,
    });
    if (error) throw new Error(error.message);
    return { candidateId: candidate.id, copyId: candidate.copy_id, isbn13: candidate.isbn13, selected: true, source };
  });
}
