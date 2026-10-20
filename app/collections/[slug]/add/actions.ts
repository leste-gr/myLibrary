"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canonicalIsbn } from "@/lib/isbn";
import { lookupIsbnEdition } from "@/lib/isbn-edition";
import { newIsbnBookSchema } from "@/lib/add-isbn-book";

async function ownedCollection(slug: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in to add a book.");
  const { data: collection, error } = await supabase.from("collections").select("id,slug")
    .eq("slug", slug).eq("owner_id", user.id).maybeSingle();
  if (error || !collection) throw new Error("Collection not found.");
  return { supabase, collection };
}

export async function previewIsbnBook(slug: string, rawIsbn: string) {
  const isbn = canonicalIsbn(rawIsbn);
  if (!isbn) return { error: "Invalid ISBN-10 or ISBN-13." };
  try {
    await ownedCollection(slug);
    const metadata = await lookupIsbnEdition(isbn);
    return { isbn, metadata };
  } catch (error) {
    console.error("ISBN preview failed", error);
    return { error: "Could not look up this ISBN. Please try again." };
  }
}

export async function addIsbnBook(slug: string, form: FormData) {
  try {
    const { supabase, collection } = await ownedCollection(slug);
    const parsed = newIsbnBookSchema.safeParse({
      collectionId: collection.id, requestId: form.get("requestId"), isbn: form.get("isbn"),
      title: form.get("title"), authors: String(form.get("authors") ?? "").split("\n").map(s => s.trim()).filter(Boolean),
      publisher: form.get("publisher"), language: form.get("language"), publishedDate: form.get("publishedDate"),
    });
    if (!parsed.success) return { error: "Check the ISBN and book details before adding." };
    const input = parsed.data;
    const { data, error } = await supabase.rpc("add_owned_isbn_book", {
      target_collection_id: collection.id, target_isbn: input.isbn, request_id: input.requestId,
      book_metadata: { title: input.title, authors: input.authors, publishers: input.publisher ? [input.publisher] : [],
        language: input.language || null, publishedDate: input.publishedDate || null },
    });
    if (error) throw error;
    revalidatePath("/");
    revalidatePath(`/collections/${collection.slug}`);
    return { legacyId: String(data.legacyId), duplicate: Boolean(data.duplicate) };
  } catch (error) {
    console.error("Add ISBN book failed", error);
    return { error: "Could not add this book. Please try again." };
  }
}
