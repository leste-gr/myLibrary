import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return new Response("Invalid cover asset", { status: 400 });
  const { url, key } = supabaseConfig();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await supabase.from("cover_assets").select("source_url,provider_identifiers,verification_status").eq("id", id).neq("verification_status", "owner_rejected").maybeSingle();
  if (!data) return new Response("Cover unavailable", { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } });
  const identifiers = (data.provider_identifiers ?? {}) as Record<string, unknown>;
  const firstIdentifier = (kind: string) => Array.isArray(identifiers[kind]) && typeof identifiers[kind][0] === "string" ? identifiers[kind][0] as string : null;
  const coverId = firstIdentifier("coverId");
  const editionOlid = firstIdentifier("editionOlid");
  if (editionOlid && /^OL\d+M$/.test(editionOlid)) {
    return new Response(null, { status: 307, headers: { Location: `https://covers.openlibrary.org/b/olid/${editionOlid}-L.jpg?default=false`, "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  }
  if (coverId && /^\d+$/.test(coverId)) {
    return new Response(null, { status: 307, headers: { Location: `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`, "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  }
  let target: URL;
  try { target = new URL(data.source_url, request.url); } catch { return new Response("Invalid cover source", { status: 502 }); }
  if (target.origin !== new URL(request.url).origin && target.hostname !== "covers.openlibrary.org") return new Response("External cover source is not permitted", { status: 502 });
  return new Response(null, { status: 307, headers: { Location: target.toString(), "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
