import { NextResponse } from "next/server";
import { processManualGenaiImport } from "@/lib/process-manual-import";
import { resolveMetadataCover, unresolvedMetadataCoverInputs } from "@/lib/metadata-cover-resolver";
import { mapWithConcurrency } from "@/lib/isbn-matcher";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const importId = (await params).id;
    const result = await processManualGenaiImport(supabase, importId);
    const coverInputs = await unresolvedMetadataCoverInputs(supabase, importId);
    const covers = await mapWithConcurrency(coverInputs, 2, (input) => resolveMetadataCover(supabase, input));
    return NextResponse.json({ ...result, metadataCovers: covers.filter(Boolean).length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ISBN matching failed.";
    const status = message.includes("0 rows") || message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
