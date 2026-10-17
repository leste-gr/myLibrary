import type { SupabaseClient } from "@supabase/supabase-js";
import { findIsbnCandidates, mapWithConcurrency, type IsbnMatchInput } from "./isbn-matcher";
import { nextHourlyRetry } from "./ingestion-retry";

type ObservationRow = {
  id: string;
  copy_id: string | null;
  title_text: string | null;
  author_text: string | null;
  publisher_text: string | null;
  language_hint: string | null;
  raw_payload: Record<string, unknown> | null;
};

function observationInput(observation: ObservationRow): IsbnMatchInput {
  const raw = observation.raw_payload ?? {};
  const authors = Array.isArray(raw.authors)
    ? raw.authors.filter((author): author is string => typeof author === "string" && Boolean(author.trim()))
    : (observation.author_text ?? "").split(",").map((author) => author.trim()).filter(Boolean);
  const publicationYear = typeof raw.publicationYear === "number" && Number.isInteger(raw.publicationYear) ? raw.publicationYear : null;
  return {
    title: observation.title_text ?? String(raw.title ?? ""),
    authors,
    publisher: observation.publisher_text ?? (typeof raw.publisher === "string" ? raw.publisher : null),
    publicationYear,
    language: observation.language_hint ?? (typeof raw.language === "string" ? raw.language : null),
    series: typeof raw.series === "string" ? raw.series : null,
  };
}

async function updateStatuses(supabase: SupabaseClient, ids: string[], status: "matched" | "unresolved" | "ready_for_matching") {
  if (!ids.length) return;
  const { error } = await supabase.from("book_observations").update({ status }).in("id", ids);
  if (error) throw new Error(error.message);
}

async function runManualGenaiImportMatching(supabase: SupabaseClient, importId: string) {
  const { data: importRecord, error: importError } = await supabase
    .from("manual_genai_imports")
    .select("id,collection_id,book_count")
    .eq("id", importId)
    .single();
  if (importError || !importRecord) throw new Error(importError?.message || "Import not found.");

  const { data, error: observationsError } = await supabase
    .from("book_observations")
    .select("id,copy_id,title_text,author_text,publisher_text,language_hint,raw_payload")
    .eq("manual_genai_import_id", importId)
    .eq("status", "ready_for_matching")
    .order("detection_index", { ascending: true });
  if (observationsError) throw new Error(observationsError.message);
  const observations = (data ?? []) as ObservationRow[];

  const processed = await mapWithConcurrency(observations, 3, async (observation) => ({
    observation,
    result: await findIsbnCandidates(observationInput(observation)),
  }));

  const copyIds = observations.flatMap((observation) => observation.copy_id ? [observation.copy_id] : []);
  const { data: rejectedFeedback, error: feedbackError } = copyIds.length
    ? await supabase.from("candidate_feedback").select("copy_id,replacement_isbn13").eq("action", "rejected").in("copy_id", copyIds)
    : { data: [], error: null };
  if (feedbackError) throw new Error(feedbackError.message);
  const rejectedByCopy = new Map<string, Set<string>>();
  for (const feedback of rejectedFeedback ?? []) {
    if (!feedback.replacement_isbn13) continue;
    rejectedByCopy.set(feedback.copy_id, new Set([...(rejectedByCopy.get(feedback.copy_id) ?? []), feedback.replacement_isbn13]));
  }

  const candidateRows = processed.flatMap(({ observation, result }) => {
    if (!observation.copy_id) return [];
    return result.candidates.filter((candidate) => !rejectedByCopy.get(observation.copy_id as string)?.has(candidate.isbn13)).map((candidate) => ({
      copy_id: observation.copy_id,
      isbn13: candidate.isbn13,
      title: candidate.title,
      publishers: candidate.publishers,
      published_date: candidate.publishedDate,
      provider: "isbn-matcher-v3",
      provider_id: candidate.providerId || candidate.isbn13,
      score: candidate.score,
      suggested: candidate.rank === 1,
      rank: candidate.rank,
      evidence: candidate.evidence,
      selection_state: "alternative",
      confidence: candidate.confidence,
      algorithm_version: "isbn-ranker-v3",
      score_breakdown: candidate.scoreBreakdown,
      provider_count: candidate.providerCount,
      provider_identifiers: candidate.providerIdentifiers,
      work_confidence: candidate.workConfidence,
      edition_confidence: candidate.editionConfidence,
      auto_accept: candidate.autoAccept,
      last_evaluated_at: new Date().toISOString(),
    }));
  });

  if (copyIds.length) {
    const { data: priorSelections, error: selectionError } = await supabase
      .from("edition_candidates")
      .select("copy_id")
      .eq("provider", "isbn-matcher-v3")
      .eq("selection_state", "algorithm_selected")
      .in("copy_id", copyIds);
    if (selectionError) throw new Error(selectionError.message);
    const resetCopyIds = [...new Set((priorSelections ?? []).map((candidate) => candidate.copy_id as string))];
    if (resetCopyIds.length) {
      const { error: resetError } = await supabase
        .from("copies")
        .update({ edition_id: null, cover_url: null, cover_source: null, edition_verification_state: "unresolved" })
        .in("id", resetCopyIds)
        .eq("edition_verification_state", "algorithm_selected");
      if (resetError) throw new Error(resetError.message);
    }
    const { error: deleteError } = await supabase.from("edition_candidates").delete().eq("provider", "isbn-matcher-v3").in("copy_id", copyIds);
    if (deleteError) throw new Error(deleteError.message);
  }
  if (candidateRows.length) {
    const { error: candidateError } = await supabase.from("edition_candidates").upsert(candidateRows, { onConflict: "copy_id,isbn13" });
    if (candidateError) throw new Error(candidateError.message);
  }

  const hasAcceptedCandidate = ({ observation, result }: (typeof processed)[number]) => result.candidates.some((candidate) => candidate.autoAccept && (!observation.copy_id || !rejectedByCopy.get(observation.copy_id)?.has(candidate.isbn13)));
  const matchedIds = processed.filter(hasAcceptedCandidate).map(({ observation }) => observation.id);
  const unresolvedIds = processed.filter((item) => !hasAcceptedCandidate(item) && item.result.providerFailures === 0).map(({ observation }) => observation.id);
  const retryableIds = processed.filter((item) => !hasAcceptedCandidate(item) && item.result.providerFailures > 0).map(({ observation }) => observation.id);
  await updateStatuses(supabase, matchedIds, "matched");
  await updateStatuses(supabase, unresolvedIds, "unresolved");

  const summary = {
    importId,
    books: observations.length,
    matched: matchedIds.length,
    unresolved: unresolvedIds.length,
    candidates: candidateRows.length,
    retryable: retryableIds.length,
  };
  const { error: completionError } = await supabase.rpc("finish_isbn_matching", { target_import_id: importId });
  if (completionError) throw new Error(completionError.message);
  return summary;
}

export async function processManualGenaiImport(supabase: SupabaseClient, importId: string) {
  const { error: startError } = await supabase.from("manual_genai_imports").update({
    matching_status: "processing",
    matching_error: null,
    matching_started_at: new Date().toISOString(),
    matching_completed_at: null,
  }).eq("id", importId);
  if (startError) throw new Error(startError.message);
  try {
    return await runManualGenaiImportMatching(supabase, importId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ISBN matching failed.";
    await supabase.from("manual_genai_imports").update({
      matching_status: "failed",
      matching_error: message.slice(0, 1000),
      matching_completed_at: new Date().toISOString(),
      next_retry_at: nextHourlyRetry(),
    }).eq("id", importId);
    throw error;
  }
}
