import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";
const ALLOWED_HOSTS = new Set(["covers.openlibrary.org", "books.google.com", "books.googleusercontent.com"]);

export async function GET(_request: Request, { params }: { params: Promise<{ copyId: string }> }) {
  const { url, key } = supabaseConfig();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await supabase.from("metadata_cover_candidates").select("source_url,provider").eq("copy_id", (await params).copyId).eq("selected", true).maybeSingle();
  if (!data) return new Response("Cover unavailable", { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } });
  try {
    const source = new URL(data.source_url); if (source.protocol !== "https:" || !ALLOWED_HOSTS.has(source.hostname)) throw new Error();
    const response = await fetch(source, { signal: AbortSignal.timeout(8000), next: { revalidate: 2592000 } });
    const type = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
    if (!response.ok || !type.startsWith("image/")) throw new Error();
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw new Error();
    return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800", "X-Cover-Source": data.provider } });
  } catch { return new Response("Cover unavailable", { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } }); }
}

