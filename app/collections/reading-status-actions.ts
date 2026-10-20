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
    revalidatePath("/radar");
    return { success: true };
  } catch (error) {
    console.error("Reading status update failed", error);
    return { error: "Could not save reading status. Please try again." };
  }
}

export async function changeBooksReadingStatus(slug: string, legacyIds: string[], status: string) {
  if (!isReadingStatus(status) || typeof slug !== "string" || !slug || slug.length > 200
    || !Array.isArray(legacyIds) || legacyIds.length < 1 || legacyIds.length > 1000
    || legacyIds.some(id => typeof id !== "string" || !id || id.length > 200)
    || new Set(legacyIds).size !== legacyIds.length) {
    return { error: "Could not update the selected books. Please try again." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Please sign in to change reading status." };
    const { data: collection, error: collectionError } = await supabase.from("collections").select("id,slug")
      .eq("slug", slug).eq("owner_id", user.id).maybeSingle();
    if (collectionError || !collection) throw new Error("Collection ownership required.");
    const { data: updated, error } = await supabase.rpc("set_owned_books_reading_status", {
      target_collection_id: collection.id, target_legacy_ids: legacyIds, new_status: status,
    });
    if (error || updated !== legacyIds.length) throw error ?? new Error("Unexpected update count.");
    revalidatePath(`/collections/${collection.slug}`);
    revalidatePath("/radar");
    return { updated: Number(updated) };
  } catch (error) {
    console.error("Bulk reading status update failed", error);
    return { error: "Could not update the selected books. Please try again." };
  }
}
