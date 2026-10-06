"use server";

import { randomBytes } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hashImportCode } from "@/lib/chatgpt-import";

export type ImportSessionState = {
  code?: string;
  collectionSlug?: string;
  error?: string;
};

function slugFor(name: string) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "collection";
  return `${base}-${randomBytes(4).toString("hex")}`;
}

export async function createChatGptImportSession(_state: ImportSessionState, formData: FormData): Promise<ImportSessionState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Η σύνδεσή σου έληξε. Συνδέσου ξανά." };

  const destination = String(formData.get("destination") ?? "");
  let collection: { id: string; slug: string } | null = null;
  if (destination === "new") {
    const name = String(formData.get("collectionName") ?? "").trim().slice(0, 100);
    const description = String(formData.get("collectionDescription") ?? "").trim().slice(0, 500);
    if (!name) return { error: "Πρόσθεσε όνομα για τη νέα συλλογή." };
    const created = await supabase.from("collections").insert({ owner_id: user.id, slug: slugFor(name), name, description: description || null }).select("id,slug").single();
    if (created.error || !created.data) return { error: "Δεν δημιουργήθηκε η συλλογή." };
    collection = created.data;
  } else {
    const found = await supabase.from("collections").select("id,slug").eq("id", destination).eq("owner_id", user.id).maybeSingle();
    collection = found.data;
  }
  if (!collection) return { error: "Επίλεξε μια συλλογή." };

  const code = `ML-${randomBytes(4).toString("hex").toUpperCase()}`;
  const inserted = await supabase.from("chatgpt_import_sessions").insert({
    collection_id: collection.id,
    owner_id: user.id,
    code_hash: hashImportCode(code),
  });
  if (inserted.error) return { error: "Δεν δημιουργήθηκε ο κωδικός εισαγωγής." };
  return { code, collectionSlug: collection.slug };
}
