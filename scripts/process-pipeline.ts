import { createClient } from "@supabase/supabase-js";
import { processManualGenaiImport } from "../lib/process-manual-import";

type CoverJob = { isbn13: string; attempts: number };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl = process.env.MYLIBRARY_SITE_URL?.replace(/\/$/, "");
if (!url || !serviceRoleKey || !siteUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MYLIBRARY_SITE_URL are required.");
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const maxImports = Number(process.env.PIPELINE_MAX_IMPORTS ?? 10);
const maxCovers = Number(process.env.PIPELINE_MAX_COVERS ?? 100);

async function runStage2() {
  let processed = 0;
  while (processed < maxImports) {
    const { data: importId, error } = await supabase.rpc("claim_next_isbn_match");
    if (error) throw new Error(`Stage 2 claim failed: ${error.message}`);
    if (!importId) break;
    await processManualGenaiImport(supabase, importId as string);
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
      status: "failed", error: message.slice(0, 1000), completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
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

const stage2 = await runStage2();
const stage3 = await runStage3();
console.log(JSON.stringify({ stage2Imports: stage2, stage3Covers: stage3 }));

