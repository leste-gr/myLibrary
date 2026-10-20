"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isReadingStatus } from "@/lib/reading-status";

export async function changeReadingStatus(slug: string, legacyId: string, status: string) {
  if (!isReadingStatus(status) || !slug || !legacyId || slug.length > 200 || legacyId.length > 200) {
    return { error: "Could not save reading status. Please try again." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Please sign in to change reading status." };
    const { data: collection, error: collectionError } = await supabase.from("collections").select("id,slug")
      .eq("slug", slug).eq("owner_id", user.id).maybeSingle();
    if (collectionError || !collection) throw new Error("Collection ownership required.");
    const { error } = await supabase.rpc("set_owned_book_reading_status", {
      target_collection_id: collection.id, target_legacy_id: legacyId, new_status: status,
    });
    if (error) throw error;
    revalidatePath(`/collections/${collection.slug}`);
    return { success: true };
  } catch (error) {
    console.error("Reading status update failed", error);
    return { error: "Could not save reading status. Please try again." };
  }
}
