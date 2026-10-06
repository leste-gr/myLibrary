import { createClient } from "@supabase/supabase-js";
import books from "@/books.json";
import isbns from "@/isbn.json";
import type { CatalogueBook } from "@/lib/types";

type PublicRow = {
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

export async function getPublicCatalogue(): Promise<CatalogueBook[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return localCatalogue();

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("public_catalogue")
    .select("*")
    .order("display_order", { ascending: true });

  if (error || !data) {
    console.error("Supabase catalogue unavailable; serving bundled catalogue.", error);
    return localCatalogue();
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
