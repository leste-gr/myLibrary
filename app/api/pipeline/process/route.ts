import { createClient } from "@supabase/supabase-js";
import { processManualGenaiImport } from "@/lib/process-manual-import";
import { processCoverResolution } from "@/lib/process-cover-resolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
      stage2++;
    }
    const covers = await processCoverResolution(supabase, siteUrl);
    stage3 = covers.stage3Covers;
    return Response.json({ stage2Imports: stage2, ...covers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Pipeline failed.", stage2Imports: stage2, stage3Covers: stage3 }, { status: 500 });
  }
}

