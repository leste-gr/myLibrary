"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function saveEditionDraft(formData: FormData) {
  const candidateId = String(formData.get("candidateId") ?? "");
  const copyId = String(formData.get("copyId") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  if (!candidateId || !copyId || !legacyId) throw new Error("Missing edition selection.");

  const { supabase, user } = await authenticatedClient();
  const { data: candidate, error: candidateError } = await supabase
    .from("edition_candidates")
    .select("*")
    .eq("id", candidateId)
    .eq("copy_id", copyId)
    .single();
  if (candidateError || !candidate) throw new Error("Edition candidate not found.");

  const { data: edition, error: editionError } = await supabase
    .from("editions")
    .upsert({
      isbn13: candidate.isbn13,
      title: candidate.title,
      publishers: candidate.publishers,
      published_date: candidate.published_date,
      cover_url: candidate.cover_url,
      provider: candidate.provider,
      provider_id: candidate.provider_id,
      metadata: { evidence: candidate.evidence },
      updated_at: new Date().toISOString(),
    }, { onConflict: "isbn13" })
    .select("id")
    .single();
  if (editionError || !edition) throw new Error("Could not save edition.");

  const { error: draftError } = await supabase.from("copy_drafts").upsert({
    copy_id: copyId,
    edition_id: edition.id,
    cover_url: candidate.cover_url,
    created_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "copy_id" });
  if (draftError) throw new Error("Could not save draft.");

  revalidatePath("/admin");
  revalidatePath("/admin/books/" + legacyId);
  redirect("/admin/books/" + legacyId + "?saved=1");
}

export async function publishEditionDraft(formData: FormData) {
  const copyId = String(formData.get("copyId") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("publish_copy_draft", { target_copy_id: copyId });
  if (error) throw new Error("Could not publish edition: " + error.message);

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/books/" + legacyId);
  redirect("/admin/books/" + legacyId + "?published=1");
}

export async function discardEditionDraft(formData: FormData) {
  const copyId = String(formData.get("copyId") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.from("copy_drafts").delete().eq("copy_id", copyId);
  if (error) throw new Error("Could not discard draft.");

  revalidatePath("/admin");
  revalidatePath("/admin/books/" + legacyId);
  redirect("/admin/books/" + legacyId);
}
