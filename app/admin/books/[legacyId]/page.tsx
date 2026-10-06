import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function LegacyAdminBookRedirect({ params }: { params: Promise<{ legacyId: string }> }) {
  const { legacyId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: collection } = await supabase.from("collections").select("slug").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!collection) notFound();
  redirect(`/collections/${collection.slug}/books/${legacyId}`);
}
