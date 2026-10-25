"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function updateCollection(slug: string, _previous: { error: string }, form: FormData) {
  const name = form.get("name");
  const description = form.get("description");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 200
    || typeof name !== "string" || !name.trim() || name.trim().length > 120
    || typeof description !== "string" || description.trim().length > 1000) {
    return { error: "Enter a collection name of 1–120 characters and a description of up to 1,000 characters." };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=" + encodeURIComponent(`/collections/${slug}/edit`));

  try {
    // Match ownership on the write itself; RLS also restricts updates to the browser owner.
    const { data, error } = await supabase.from("collections")
      .update({ name: name.trim(), description: description.trim() || null })
      .eq("slug", slug).eq("owner_id", user.id).select("id").maybeSingle();
    if (error || !data) return { error: "Could not save collection details. Please try again." };
  } catch {
    return { error: "Could not save collection details. Please try again." };
  }
  revalidatePath("/");
  revalidatePath(`/collections/${slug}`);
  revalidatePath(`/collections/${slug}/edit`);
  revalidatePath("/radar");
  redirect(`/collections/${slug}?collectionSaved=1`);
}
