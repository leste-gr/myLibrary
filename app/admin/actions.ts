"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canonicalIsbn, isbnCoverPath } from "@/lib/isbn";

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

function editPath(collectionSlug: string, legacyId: string, query = "") {
  const base = collectionSlug ? `/collections/${collectionSlug}/books/${legacyId}` : `/admin/books/${legacyId}`;
  return base + query;
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
  const collectionSlug = String(formData.get("collectionSlug") ?? "");
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
  if (collectionSlug) revalidatePath("/collections/" + collectionSlug);
  redirect(editPath(collectionSlug, legacyId, "?saved=1"));
}

export async function saveManualIsbnDraft(formData: FormData) {
  const rawIsbn = String(formData.get("isbn") ?? "");
  const copyId = String(formData.get("copyId") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  const collectionSlug = String(formData.get("collectionSlug") ?? "");
  const isbn13 = canonicalIsbn(rawIsbn);
  if (!isbn13) redirect(editPath(collectionSlug, legacyId, "?error=" + encodeURIComponent("Μη έγκυρο ISBN-10 ή ISBN-13.")));

  const { supabase, user } = await authenticatedClient();
  const { data: collection } = await supabase
    .from("collections")
    .select("id")
    .eq("owner_id", user.id)
    .eq("slug", collectionSlug)
    .single();
  if (!collection) throw new Error("Collection not found.");
  const { data: copy } = await supabase
    .from("copies")
    .select("id,work:works(title)")
    .eq("id", copyId)
    .eq("collection_id", collection.id)
    .single();
  if (!copy) throw new Error("Book not found.");

  const coverUrl = isbnCoverPath(isbn13);
  const work = Array.isArray(copy.work) ? copy.work[0] : copy.work;
  let { data: edition } = await supabase.from("editions").select("id").eq("isbn13", isbn13).maybeSingle();
  if (!edition) {
    const created = await supabase.from("editions").insert({
      isbn13,
      title: work?.title ?? null,
      cover_url: coverUrl,
      provider: "manual",
      provider_id: `manual:${isbn13}`,
      metadata: { evidence: ["manual ISBN entry"] },
    }).select("id").single();
    if (created.error || !created.data) throw new Error("Could not save ISBN.");
    edition = created.data;
  }

  await supabase.from("edition_candidates").update({ suggested: false }).eq("copy_id", copyId);
  const { error: candidateError } = await supabase.from("edition_candidates").upsert({
    copy_id: copyId,
    isbn13,
    title: work?.title ?? null,
    publishers: [],
    cover_url: coverUrl,
    provider: "manual",
    provider_id: `manual:${isbn13}`,
    score: 1000,
    suggested: true,
    rank: 0,
    evidence: ["manual ISBN entry"],
  }, { onConflict: "copy_id,isbn13" });
  if (candidateError) throw new Error("Could not save ISBN candidate.");

  const { error: draftError } = await supabase.from("copy_drafts").upsert({
    copy_id: copyId,
    edition_id: edition.id,
    cover_url: coverUrl,
    created_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "copy_id" });
  if (draftError) throw new Error("Could not save ISBN draft.");

  revalidatePath("/collections/" + collectionSlug);
  revalidatePath(editPath(collectionSlug, legacyId));
  redirect(editPath(collectionSlug, legacyId, "?saved=1"));
}

export async function publishEditionDraft(formData: FormData) {
  const copyId = String(formData.get("copyId") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  const collectionSlug = String(formData.get("collectionSlug") ?? "");
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("publish_copy_draft", { target_copy_id: copyId });
  if (error) throw new Error("Could not publish edition: " + error.message);

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/books/" + legacyId);
  if (collectionSlug) revalidatePath("/collections/" + collectionSlug);
  redirect(editPath(collectionSlug, legacyId, "?published=1"));
}

export async function discardEditionDraft(formData: FormData) {
  const copyId = String(formData.get("copyId") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  const collectionSlug = String(formData.get("collectionSlug") ?? "");
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.from("copy_drafts").delete().eq("copy_id", copyId);
  if (error) throw new Error("Could not discard draft.");

  revalidatePath("/admin");
  revalidatePath("/admin/books/" + legacyId);
  if (collectionSlug) revalidatePath("/collections/" + collectionSlug);
  redirect(editPath(collectionSlug, legacyId));
}
