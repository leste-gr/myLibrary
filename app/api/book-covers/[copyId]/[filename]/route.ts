import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MAX_COVER_UPLOAD_BYTES } from "@/lib/book-cover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ copyId: string; filename: string }> }) {
  const { copyId, filename } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(copyId) || !/^[0-9a-f-]{36}\.webp$/i.test(filename)) return new Response("Cover not found", { status: 404 });
  const supabase = await createSupabaseServerClient();
  // Copy RLS and private Storage policies both check public visibility/ownership.
  const { data: copy } = await supabase.from("copies").select("owner_cover_path").eq("id", copyId).maybeSingle();
  const path = copy?.owner_cover_path as string | null | undefined;
  if (!path || path.split("/")[2] !== filename) return new Response("Cover not found", { status: 404 });
  const { data: image, error } = await supabase.storage.from("book-covers").download(path);
  if (error || !image || image.size > MAX_COVER_UPLOAD_BYTES) return new Response("Cover not found", { status: 404 });
  return new Response(image, { headers: {
    "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
