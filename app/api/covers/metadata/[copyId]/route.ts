import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";
import { fetchPublicResource } from "@/lib/safe-remote-fetch";

export const runtime = "nodejs";
const ALLOWED_HOSTS = new Set(["covers.openlibrary.org", "books.google.com", "books.googleusercontent.com"]);

export async function GET(request: Request, { params }: { params: Promise<{ copyId: string }> }) {
  const { url, key } = supabaseConfig();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await supabase.from("metadata_cover_candidates").select("source_url,provider").eq("copy_id", (await params).copyId).eq("selected", true).maybeSingle();
  if (!data) return new Response("Cover unavailable", { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } });
  try {
    if (/^\/covers\/[A-Za-z0-9._-]+\.(?:avif|jpe?g|png|webp)$/i.test(data.source_url)) {
      return new Response(null, { status: 307, headers: { Location: new URL(data.source_url, request.url).toString(), "Cache-Control": "public, max-age=86400, s-maxage=2592000", "X-Cover-Source": data.provider } });
    }
    const source = new URL(data.source_url); if (data.provider !== "web-page" && !ALLOWED_HOSTS.has(source.hostname)) throw new Error();
    const image = await fetchPublicResource(source, { maxBytes: 8 * 1024 * 1024, acceptedTypes: (type) => type.startsWith("image/") && type !== "image/svg+xml", headers: { "User-Agent": "myLibrary-cover-resolver/1.0" }, timeoutMs: 10_000 });
    return new Response(image.bytes, { headers: { "Content-Type": image.contentType, "Cache-Control": "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800", "X-Cover-Source": data.provider } });
  } catch { return new Response("Cover unavailable", { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } }); }
}

