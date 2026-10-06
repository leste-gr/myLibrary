import { createClient } from "@supabase/supabase-js";
import books from "@/books.json";
import isbns from "@/isbn.json";
import type { CatalogueBook, PublicCollection } from "@/lib/types";

type PublicRow = {
  collection_slug: string;
  collection_name: string;
  legacy_id: string;
  title: string;
  author: string;
  contributors: string | null;
  series: string | null;
  subseries: string | null;
  volume: string | null;
  language: string;
  category: string;
  publisher: string | null;
  notes: string | null;
  cover_url: string | null;
  cover_source: string | null;
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

const localCollection: PublicCollection = {
  id: "local",
  slug: "lefteris",
  name: "Η βιβλιοθήκη του Λευτέρη",
  description: "Ιστορίες που μένουν, κόσμοι που περιμένουν.",
  bookCount: books.length,
  authorCount: new Set(books.map((book) => book.author)).size,
};

function localCatalogue(): CatalogueBook[] {
  const accepted = isbns as Record<string, string>;
  return books.map((book) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    contributors: book.contributors,
    series: book.series,
    subseries: book.subseries,
    volume: book.volume,
    language: book.language,
    category: book.category,
    publisher: book.publisher,
    notes: book.notes,
    cover: book.cover ? "/" + book.cover : null,
    coverSource: book.coverSource ?? null,
    isbn13: accepted[book.id] ?? null,
  }));
}

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

export async function getPublicCollections(): Promise<PublicCollection[]> {
  const supabase = publicClient();
  if (!supabase) return [localCollection];

  const { data, error } = await supabase
    .from("public_collections")
    .select("*")
    .order("created_at", { ascending: true });

  if (error || !data) {
    console.error("Supabase collections unavailable; serving bundled collection.", error);
    return [localCollection];
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
  const collections = await getPublicCollections();
  return collections.find((collection) => collection.slug === slug) ?? null;
}

export async function getPublicCatalogue(slug: string): Promise<CatalogueBook[]> {
  const supabase = publicClient();
  if (!supabase) return slug === localCollection.slug ? localCatalogue() : [];

  const { data, error } = await supabase
    .from("public_catalogue")
    .select("*")
    .eq("collection_slug", slug)
    .order("display_order", { ascending: true });

  if (error || !data) {
    console.error("Supabase catalogue unavailable; serving bundled catalogue.", error);
    return slug === localCollection.slug ? localCatalogue() : [];
  }

  return (data as PublicRow[]).map((row) => ({
    id: row.legacy_id,
    title: row.title,
    author: row.author,
    contributors: row.contributors,
    series: row.series ?? "",
    subseries: row.subseries,
    volume: row.volume,
    language: row.language,
    category: row.category,
    publisher: row.publisher,
    notes: row.notes,
    cover: row.cover_url,
    coverSource: row.cover_source,
    isbn13: row.isbn13,
  }));
}
