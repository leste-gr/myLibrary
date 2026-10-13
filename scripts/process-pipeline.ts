import { createClient } from "@supabase/supabase-js";
import { processManualGenaiImport } from "../lib/process-manual-import";
import { resolveCandidateCovers } from "../lib/candidate-cover-resolver";
import { resolveMetadataCover, unresolvedMetadataCoverInputs } from "../lib/metadata-cover-resolver";
import { mapWithConcurrency } from "../lib/isbn-matcher";

type CoverJob = { isbn13: string; attempts: number };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configuredSiteUrl = process.env.MYLIBRARY_SITE_URL?.replace(/\/$/, "");
if (!url || !serviceRoleKey || !configuredSiteUrl) {
  throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, and MYLIBRARY_SITE_URL are required.");
}
const siteUrl = configuredSiteUrl;

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const maxImports = Number(process.env.PIPELINE_MAX_IMPORTS ?? 10);
const maxCovers = Number(process.env.PIPELINE_MAX_COVERS ?? 100);
const maxMetadataCovers = Number(process.env.PIPELINE_MAX_METADATA_COVERS ?? 10);

async function runStage2() {
  let processed = 0;
  while (processed < maxImports) {
    const { data: importId, error } = await supabase.rpc("claim_next_isbn_match");
    if (error) throw new Error(`Stage 2 claim failed: ${error.message}`);
    if (!importId) break;
    await processManualGenaiImport(supabase, importId as string);
    await resolveCandidateCovers(supabase, siteUrl, importId as string);
    const coverInputs = await unresolvedMetadataCoverInputs(supabase, importId as string);
    await mapWithConcurrency(coverInputs, 2, (input) => resolveMetadataCover(supabase, input));
    processed++;
  }
  return processed;
}

async function claimCoverJob(): Promise<CoverJob | null> {
  const { data, error } = await supabase.rpc("claim_next_cover_resolution");
  if (error) throw new Error(`Stage 3 claim failed: ${error.message}`);
  return ((data as CoverJob[] | null)?.[0] ?? null);
}

async function resolveCover(job: CoverJob) {
  try {
    const response = await fetch(`${siteUrl}/api/covers/${job.isbn13}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`cover endpoint returned ${response.status}`);
    await response.arrayBuffer();
    const source = response.headers.get("x-cover-source") ?? "unknown";
    const status = source === "placeholder" ? "missing" : "completed";
    const { error } = await supabase.from("cover_resolution_jobs").update({
      status, source, error: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("isbn13", job.isbn13);
    if (error) throw new Error(error.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cover resolution failed.";
    await supabase.from("cover_resolution_jobs").update({
      status: "failed", error: message.slice(0, 1000), next_retry_at: new Date(Date.now() + Math.min(60, 5 * (2 ** Math.max(0, job.attempts - 1))) * 60_000).toISOString(), completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("isbn13", job.isbn13);
  }
}

async function runStage3() {
  let processed = 0;
  while (processed < maxCovers) {
    const job = await claimCoverJob();
    if (!job) break;
    await resolveCover(job);
    processed++;
  }
  return processed;
}

async function runMetadataFallback() {
  const inputs = (await unresolvedMetadataCoverInputs(supabase)).slice(0, maxMetadataCovers);
  const results = await mapWithConcurrency(inputs, 2, (input) => resolveMetadataCover(supabase, input));
  return results.filter(Boolean).length;
}

async function main() {
  const runner = process.env.GITHUB_RUN_ID ? `github-actions:${process.env.GITHUB_RUN_ID}` : "manual";
  const { data: run, error: startError } = await supabase
    .from("ingestion_pipeline_runs")
    .insert({ runner })
    .select("id")
    .single();
  if (startError) throw new Error(`Pipeline heartbeat failed: ${startError.message}`);
  try {
    const stage2 = await runStage2();
    const stage3 = await runStage3();
    const metadataCovers = await runMetadataFallback();
    const { error } = await supabase.from("ingestion_pipeline_runs").update({
      status: "completed", stage2_imports: stage2, stage3_covers: stage3, completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    if (error) throw new Error(`Pipeline heartbeat completion failed: ${error.message}`);
    console.log(JSON.stringify({ stage2Imports: stage2, stage3Covers: stage3, metadataCovers }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline failed.";
    await supabase.from("ingestion_pipeline_runs").update({
      status: "failed", error: message.slice(0, 1000), completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

