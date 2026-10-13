import { createClient } from "@supabase/supabase-js";
import { processManualGenaiImport } from "@/lib/process-manual-import";
import { resolveCandidateCovers } from "@/lib/candidate-cover-resolver";
import { resolveMetadataCover, unresolvedMetadataCoverInputs } from "@/lib/metadata-cover-resolver";
import { mapWithConcurrency } from "@/lib/isbn-matcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CoverJob = { isbn13: string; attempts: number };

function serviceRoleToken(request: Request) {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7);
  if (token.startsWith("sb_secret_")) return token;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { role?: string };
    return payload.role === "service_role" ? token : null;
  } catch { return null; }
}

export async function POST(request: Request) {
  const token = serviceRoleToken(request);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!token || !url) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const supabase = createClient(url, token, { auth: { persistSession: false } });
  const siteUrl = new URL(request.url).origin;
  let stage2 = 0;
  let stage3 = 0;
  try {
    while (stage2 < 10) {
      const { data: importId, error } = await supabase.rpc("claim_next_isbn_match");
      if (error) throw new Error(error.message);
      if (!importId) break;
      await processManualGenaiImport(supabase, importId as string);
      await resolveCandidateCovers(supabase, siteUrl, importId as string);
      const coverInputs = await unresolvedMetadataCoverInputs(supabase, importId as string);
      await mapWithConcurrency(coverInputs, 2, (input) => resolveMetadataCover(supabase, input));
      stage2++;
    }
    while (stage3 < 100) {
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
          status: "failed", error: message.slice(0, 1000), next_retry_at: new Date(Date.now() + Math.min(60, 5 * (2 ** Math.max(0, job.attempts - 1))) * 60_000).toISOString(), completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("isbn13", job.isbn13);
      }
      stage3++;
    }
    return Response.json({ stage2Imports: stage2, stage3Covers: stage3 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Pipeline failed.", stage2Imports: stage2, stage3Covers: stage3 }, { status: 500 });
  }
}

