"use server";
import { getTranslations } from "@/lib/i18n/server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canonicalIsbn, isbnCoverPath } from "@/lib/isbn";
import { randomUUID } from "node:crypto";
import { prepareCoverUpload } from "@/lib/cover-upload";

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

export async function uploadBookCover(formData: FormData) {
  const copyId = String(formData.get("copyId") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  const slug = String(formData.get("collectionSlug") ?? "");
  const { supabase, user } = await authenticatedClient();
  const { data: collection } = await supabase.from("collections").select("id,slug")
    .eq("slug", slug).eq("owner_id", user.id).maybeSingle();
  if (!collection || !/^[0-9a-f-]{36}$/i.test(copyId)) throw new Error("Book not found.");
  const { data: copy } = await supabase.from("copies").select("id,legacy_id")
    .eq("id", copyId).eq("legacy_id", legacyId).eq("collection_id", collection.id).maybeSingle();
  if (!copy) throw new Error("Book not found.");
  const destination = editPath(collection.slug, copy.legacy_id);
  const file = formData.get("cover");
  let image: Buffer;
  try {
    if (!(file instanceof File)) throw new Error("Choose a cover image to upload.");
    image = await prepareCoverUpload(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "This image could not be read. Choose a valid JPG, PNG or WebP file.";
    redirect(destination + "?error=" + encodeURIComponent(message));
  }
  const path = `${user.id}/${copy.id}/${randomUUID()}.webp`;
  const { error: uploadError } = await supabase.storage.from("book-covers").upload(path, image, {
    contentType: "image/webp", cacheControl: "31536000", upsert: false,
  });
  if (uploadError) {
    console.error("Owner cover upload failed", uploadError.message);
    redirect(destination + "?error=" + encodeURIComponent("Could not upload the cover. Please try again."));
  }
  const { error: selectionError } = await supabase.rpc("set_owned_book_cover", { target_copy_id: copy.id, storage_path: path });
  if (selectionError) {
    await supabase.storage.from("book-covers").remove([path]);
    console.error("Owner cover selection failed", selectionError.message);
    redirect(destination + "?error=" + encodeURIComponent("Could not save the cover. Please try again."));
  }
  revalidatePath("/");
  revalidatePath(`/collections/${collection.slug}`);
  revalidatePath(destination);
  redirect(destination + "?coverSaved=1");
}

export async function deleteCollection(formData: FormData) {
  const collectionId = String(formData.get("collectionId") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(collectionId)) throw new Error("Invalid collection.");
  const { supabase, user } = await authenticatedClient();
  const { data: collection } = await supabase.from("collections").select("id,slug").eq("id", collectionId).eq("owner_id", user.id).maybeSingle();
  if (!collection) throw new Error("Collection not found.");
  const { error } = await supabase.rpc("delete_owned_collection", { target_collection_id: collection.id });
  if (error) throw new Error("Could not delete collection: " + error.message);
  revalidatePath("/");
  revalidatePath(`/collections/${collection.slug}`);
  redirect("/?deleted=1");
}

export async function deleteBook(formData: FormData) {
  const collectionId = String(formData.get("collectionId") ?? "");
  const collectionSlug = String(formData.get("collectionSlug") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(collectionId) || !collectionSlug || !legacyId) throw new Error("Invalid book.");

  const { supabase, user } = await authenticatedClient();
  const { data: collection } = await supabase
    .from("collections")
    .select("id,slug")
    .eq("id", collectionId)
    .eq("slug", collectionSlug)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!collection) throw new Error("Collection not found.");

  const { data: copy } = await supabase
    .from("copies")
    .select("id")
    .eq("collection_id", collection.id)
    .eq("legacy_id", legacyId)
    .maybeSingle();
  if (!copy) throw new Error("Book not found.");

  const { error } = await supabase.rpc("delete_owned_book", { target_copy_id: copy.id });
  if (error) throw new Error("Could not delete book: " + error.message);
  revalidatePath("/");
  revalidatePath(`/collections/${collection.slug}`);
  redirect(`/collections/${collection.slug}?bookDeleted=1`);
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

  await supabase.from("edition_candidates").update({ selection_state: "alternative" }).eq("copy_id", copyId).neq("selection_state", "owner_rejected");
  const { error: selectionError } = await supabase.from("edition_candidates").update({ selection_state: "owner_selected" }).eq("id", candidateId);
  if (selectionError) throw new Error("Could not select edition candidate.");

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

  const { data: coverAssetId, error: coverAssetError } = await supabase.rpc("prepare_candidate_cover_asset", { target_candidate_id: candidateId });
  if (coverAssetError || !coverAssetId) throw new Error("Could not prepare cover asset.");

  const { error: draftError } = await supabase.from("copy_drafts").upsert({
    copy_id: copyId,
    edition_id: edition.id,
    cover_url: `/api/cover-assets/${coverAssetId}`,
    created_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "copy_id" });
  if (draftError) throw new Error("Could not save draft.");

  revalidatePath("/admin");
  revalidatePath("/admin/books/" + legacyId);
  if (collectionSlug) revalidatePath("/collections/" + collectionSlug);
  redirect(editPath(collectionSlug, legacyId, "?saved=1"));
}

export async function rejectEditionCandidate(formData: FormData) {
  const candidateId = String(formData.get("candidateId") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  const collectionSlug = String(formData.get("collectionSlug") ?? "");
  if (!candidateId || !legacyId || !collectionSlug) throw new Error("Missing candidate rejection.");
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("reject_edition_candidate", { target_candidate_id: candidateId, rejection_reason: "Rejected from collection page" });
  if (error) throw new Error("Could not reject edition candidate: " + error.message);
  revalidatePath("/collections/" + collectionSlug);
  revalidatePath(editPath(collectionSlug, legacyId));
  redirect(editPath(collectionSlug, legacyId, "?rejected=1"));
}

export async function saveManualIsbnDraft(formData: FormData) {
  const t = await getTranslations();
  const rawIsbn = String(formData.get("isbn") ?? "");
  const copyId = String(formData.get("copyId") ?? "");
  const legacyId = String(formData.get("legacyId") ?? "");
  const collectionSlug = String(formData.get("collectionSlug") ?? "");
  const isbn13 = canonicalIsbn(rawIsbn);
  if (!isbn13) redirect(editPath(collectionSlug, legacyId, "?error=" + encodeURIComponent(t("Invalid ISBN-10 or ISBN-13."))));

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
  const { data: manualCandidate, error: candidateError } = await supabase.from("edition_candidates").upsert({
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
    selection_state: "owner_selected",
    confidence: 1,
    algorithm_version: "manual-owner-v1",
    score_breakdown: { manual_isbn: 1000 },
    provider_count: 1,
    last_evaluated_at: new Date().toISOString(),
  }, { onConflict: "copy_id,isbn13" }).select("id").single();
  if (candidateError || !manualCandidate) throw new Error("Could not save ISBN candidate.");

  const { data: coverAssetId, error: coverAssetError } = await supabase.rpc("prepare_candidate_cover_asset", { target_candidate_id: manualCandidate.id });
  if (coverAssetError || !coverAssetId) throw new Error("Could not prepare ISBN cover asset.");

  const { error: draftError } = await supabase.from("copy_drafts").upsert({
    copy_id: copyId,
    edition_id: edition.id,
    cover_url: `/api/cover-assets/${coverAssetId}`,
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
  const { data: copy } = await supabase.from("copies").select("edition_verification_state,edition:editions(isbn13)").eq("id", copyId).single();
  await supabase.from("edition_candidates").update({ selection_state: "alternative" }).eq("copy_id", copyId).neq("selection_state", "owner_rejected");
  const edition = Array.isArray(copy?.edition) ? copy.edition[0] : copy?.edition;
  if (edition?.isbn13) {
    const restoredState = copy?.edition_verification_state === "algorithm_selected" ? "algorithm_selected" : "owner_selected";
    await supabase.from("edition_candidates").update({ selection_state: restoredState }).eq("copy_id", copyId).eq("isbn13", edition.isbn13);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/books/" + legacyId);
  if (collectionSlug) revalidatePath("/collections/" + collectionSlug);
  redirect(editPath(collectionSlug, legacyId));
}
