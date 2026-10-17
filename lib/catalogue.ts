import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./supabase/config";
import type { CatalogueBook, PublicCollection } from "./types";

type PublicRow = {
  legacy_id: string;
  title: string;
  author: string;
  series: string | null;
  language: string;
  category: string;
  publisher: string | null;
  cover_url: string | null;
  isbn13: string | null;
};

type CollectionRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  book_count: number;
  author_count: number;
};

function publicClient() {
  const { url, key } = supabaseConfig();
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getPublicCollections(collectionIds?: string[]): Promise<PublicCollection[]> {
  const supabase = publicClient();

  if (collectionIds?.length === 0) return [];
  let query = supabase
    .from("public_collections")
    .select("id,slug,name,description,book_count,author_count")
    .order("created_at", { ascending: true });
  if (collectionIds) query = query.in("id", collectionIds);
  const { data, error } = await query;

  if (error || !data) {
    throw new Error("Unable to load public collections from Supabase.", { cause: error });
  }

  return (data as CollectionRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    bookCount: row.book_count,
    authorCount: row.author_count,
  }));
}

export async function getPublicCollection(slug: string): Promise<PublicCollection | null> {
  const { data, error } = await publicClient().from("public_collections")
    .select("id,slug,name,description,book_count,author_count").eq("slug", slug).maybeSingle();
  if (error) throw new Error("Unable to load public collection from Supabase.", { cause: error });
  if (!data) return null;
  const row = data as CollectionRow;
  return { id: row.id, slug: row.slug, name: row.name, description: row.description, bookCount: row.book_count, authorCount: row.author_count };
}

export async function getPublicCatalogue(slug: string): Promise<CatalogueBook[]> {
  const supabase = publicClient();

  const { data, error } = await supabase
    .from("public_catalogue")
    .select("legacy_id,title,author,series,language,category,publisher,cover_url,isbn13")
    .eq("collection_slug", slug)
    .order("display_order", { ascending: true });

  if (error || !data) {
    throw new Error("Unable to load public catalogue from Supabase.", { cause: error });
  }

  return (data as PublicRow[]).map((row) => ({
    id: row.legacy_id,
    title: row.title,
    author: row.author,
    series: row.series ?? "",
    language: row.language,
    category: row.category,
    publisher: row.publisher,
    cover: row.cover_url,
    isbn13: row.isbn13,
  }));
}
