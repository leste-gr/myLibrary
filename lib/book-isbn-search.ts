import type { SupabaseClient } from "@supabase/supabase-js";
import { findIsbnCandidates, type IsbnMatchInput } from "./isbn-matcher";

type Relation<T> = T | T[] | null;
type Book = {
  publisher: string | null; language: string | null;
  work: Relation<{ title: string; author: string; series: string | null }>;
  edition: Relation<{ published_date: string | null }>;
};
function first<T>(value: Relation<T>) { return Array.isArray(value) ? value[0] : value; }

// Reuse Stage 2's providers/ranker without its import bookkeeping or auto-selection.
export async function findBookIsbnCandidates(supabase: SupabaseClient, copyId: string, search = findIsbnCandidates) {
  const { data, error } = await supabase.from("copies")
    .select("publisher,language,work:works(title,author,series),edition:editions(published_date)")
    .eq("id", copyId).single();
  if (error || !data) throw new Error(error?.message ?? "Book not found.");
  const book = data as unknown as Book;
  const work = first(book.work);
  const edition = first(book.edition);
  const { data: observation, error: observationError } = await supabase.from("book_observations")
    .select("raw_payload").eq("copy_id", copyId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (observationError) throw new Error(observationError.message);
  const raw = (observation?.raw_payload ?? {}) as Record<string, unknown>;
  const rawAuthors = Array.isArray(raw.authors) ? raw.authors.filter((author): author is string => typeof author === "string" && Boolean(author.trim())) : [];
  const input: IsbnMatchInput = {
    title: work?.title ?? String(raw.title ?? ""),
    authors: rawAuthors.length ? rawAuthors : (work?.author ?? "").split(",").map(author => author.trim()).filter(Boolean),
    publisher: book.publisher ?? (typeof raw.publisher === "string" ? raw.publisher : null),
    publicationYear: typeof raw.publicationYear === "number" && Number.isInteger(raw.publicationYear)
      ? raw.publicationYear : Number(edition?.published_date?.match(/\b\d{4}\b/)?.[0]) || null,
    language: book.language ?? (typeof raw.language === "string" ? raw.language : null),
    series: work?.series ?? (typeof raw.series === "string" ? raw.series : null),
  };
  const result = await search(input);
  if (!result.candidates.length && result.providerFailures) throw new Error("ISBN providers are unavailable. Please try again.");
  const { data: count, error: saveError } = await supabase.rpc("save_book_isbn_search", {
    target_copy_id: copyId, candidates: result.candidates, provider_failures: result.providerFailures,
  });
  if (saveError) throw new Error(saveError.message);
  return { count: Number(count), providerFailures: result.providerFailures };
}
