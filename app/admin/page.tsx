import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function LegacyAdminRedirect() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: collection } = await supabase.from("collections").select("slug").eq("owner_id", user.id).single();
  redirect(collection ? `/collections/${collection.slug}` : "/");
}
