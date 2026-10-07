"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type OwnedCollection = { id: string; slug: string; name: string };
const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const maximumBytes = 20 * 1024 * 1024;

function contentTypeFor(file: File) {
  if (acceptedTypes.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  return file.type;
}

function collectionSlug(name: string) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "collection";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function extensionFor(contentType: string) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" } as Record<string, string>)[contentType] ?? "jpg";
}

export function ShelfieUploadForm({ userId, collections }: { userId: string; collections: OwnedCollection[] }) {
  const router = useRouter();
  const [destination, setDestination] = useState(collections[0]?.id ?? "new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const file = form.get("shelfie");
    if (!(file instanceof File) || !file.size) return void (setError("Επίλεξε μια φωτογραφία της βιβλιοθήκης σου."), setBusy(false));
    const contentType = contentTypeFor(file);
    if (!acceptedTypes.has(contentType)) return void (setError("Υποστηρίζονται JPEG, PNG, WebP, HEIC και HEIF."), setBusy(false));
    if (file.size > maximumBytes) return void (setError("Η φωτογραφία πρέπει να είναι μικρότερη από 20 MB."), setBusy(false));

    const supabase = createSupabaseBrowserClient();
    let target = collections.find((collection) => collection.id === destination) ?? null;
    let createdCollectionId: string | null = null;
    try {
      if (destination === "new") {
        const name = String(form.get("collectionName") ?? "").trim();
        const description = String(form.get("collectionDescription") ?? "").trim();
        if (!name) throw new Error("Πρόσθεσε όνομα για τη νέα συλλογή.");
        const created = await supabase.from("collections").insert({ owner_id: userId, slug: collectionSlug(name), name, description: description || null }).select("id,slug,name").single();
        if (created.error || !created.data) throw new Error(created.error?.message || "Δεν δημιουργήθηκε η συλλογή.");
        target = created.data;
        createdCollectionId = created.data.id;
      }
      if (!target) throw new Error("Επίλεξε συλλογή.");
      const uploadFile = file.type === contentType ? file : new File([file], file.name, { type: contentType });
      const storagePath = `${userId}/${target.id}/${crypto.randomUUID()}.${extensionFor(contentType)}`;
      const uploaded = await supabase.storage.from("shelfies").upload(storagePath, uploadFile, { contentType, cacheControl: "3600", upsert: false });
      if (uploaded.error) throw new Error(uploaded.error.message);
      const recorded = await supabase.from("shelfie_uploads").insert({ collection_id: target.id, owner_id: userId, storage_path: storagePath, original_filename: file.name, content_type: contentType, byte_size: file.size, status: "queued" });
      if (recorded.error) {
        await supabase.storage.from("shelfies").remove([storagePath]);
        throw new Error(recorded.error.message);
      }
      router.push(`/collections/${target.slug}?shelfie=queued`);
      router.refresh();
    } catch (reason) {
      if (createdCollectionId) await supabase.from("collections").delete().eq("id", createdCollectionId);
      setError(reason instanceof Error ? reason.message : "Η μεταφόρτωση απέτυχε.");
      setBusy(false);
    }
  }

  return <form className="shelfie-form" onSubmit={submit}>
    <fieldset disabled={busy}><legend>Προορισμός</legend>{collections.map((collection) => <label className="choice-row" key={collection.id}><input type="radio" name="destination" value={collection.id} checked={destination === collection.id} onChange={() => setDestination(collection.id)} /><span>{collection.name}</span></label>)}<label className="choice-row"><input type="radio" name="destination" value="new" checked={destination === "new"} onChange={() => setDestination("new")} /><span>Νέα συλλογή</span></label></fieldset>
    {destination === "new" && <div className="new-collection-fields"><label htmlFor="collection-name">Όνομα συλλογής</label><input id="collection-name" name="collectionName" required maxLength={100} /><label htmlFor="collection-description">Περιγραφή <span>(προαιρετική)</span></label><textarea id="collection-description" name="collectionDescription" maxLength={500} rows={3} /></div>}
    <label className="shelfie-file" htmlFor="shelfie-file"><strong>Φωτογραφία ραφιού</strong><span>JPEG, PNG, WebP ή HEIC · έως 20 MB</span><input id="shelfie-file" name="shelfie" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" required /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Μεταφόρτωση…" : "Μεταφόρτωση shelfie"}</button>
  </form>;
}
