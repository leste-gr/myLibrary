import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCandidateCovers } from "./candidate-cover-resolver";
import { resolveMetadataCover, unresolvedMetadataCoverInputs } from "./metadata-cover-resolver";
import { mapWithConcurrency } from "./isbn-matcher";

type CoverJob = { isbn13: string; attempts: number };

// Stage 3 owns all cover discovery, after ISBN candidate identification finishes.
export async function processCoverResolution(supabase: SupabaseClient, siteUrl: string) {
  let isbnCovers = 0;
  while (isbnCovers < 100) {
    const { data, error } = await supabase.rpc("claim_next_cover_resolution");
    if (error) throw new Error(error.message);
    const job = ((data as CoverJob[] | null)?.[0] ?? null);
    if (!job) break;
    try {
      const response = await fetch(`${siteUrl}/api/covers/${job.isbn13}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`cover endpoint returned ${response.status}`);
      await response.arrayBuffer();
      const source = response.headers.get("x-cover-source") ?? "unknown";
      const status = source === "placeholder" ? "missing" : "completed";
      const { error: updateError } = await supabase.from("cover_resolution_jobs").update({
        status, source, error: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("isbn13", job.isbn13);
      if (updateError) throw new Error(updateError.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cover resolution failed.";
      await supabase.from("cover_resolution_jobs").update({
        status: "failed", error: message.slice(0, 1000), next_retry_at: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("isbn13", job.isbn13);
    }
    isbnCovers++;
  }
  const selected = await supabase.rpc("attach_resolved_isbn_covers");
  if (selected.error) throw new Error(selected.error.message);
  const candidateResults = await resolveCandidateCovers(supabase, siteUrl);
  const metadataInputs = await unresolvedMetadataCoverInputs(supabase);
  const metadataResults = await mapWithConcurrency(metadataInputs, 2, (input) => resolveMetadataCover(supabase, input));

  const candidateCovers = candidateResults.filter(result => result.selected).length;
  const metadataCovers = metadataResults.filter(Boolean).length;
  return { isbnCovers, candidateCovers, metadataCovers, stage3Covers: isbnCovers + candidateCovers + metadataCovers };
}
