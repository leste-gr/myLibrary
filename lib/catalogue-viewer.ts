import { cache } from "react";
import { createSupabaseServerClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";

// React cache shares this check between the layout and catalogue page within
// one request. It never caches an identity across requests or users.
export const getViewer = cache(async () => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  return (await supabase.auth.getUser()).data.user;
});

export async function getCollectionViewer(slug: string) {
  const user = await getViewer();
  if (!user) return { signedIn: false, canEdit: false };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("collections").select("id")
    .eq("slug", slug).eq("owner_id", user.id).maybeSingle();
  if (error) throw new Error("Unable to check collection ownership.");
  return { signedIn: true, canEdit: Boolean(data) };
}
