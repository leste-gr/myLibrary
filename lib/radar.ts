import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_BOOK_COVER } from "./book-cover";

export type RadarBook = {
  id: string; legacyId: string; title: string; author: string; cover: string;
  collectionSlug: string; collectionName: string; collectionIsPublic: boolean;
};
type Relation<T> = T | T[] | null;
type Row = {
  id: string; legacy_id: string; cover_url: string | null; cover_status: string;
  work: Relation<{title: string; author: string}>;
  edition: Relation<{cover_url: string | null}>;
  collection: Relation<{slug: string; name: string; is_public: boolean}>;
};
const first = <T,>(value: Relation<T>) => Array.isArray(value) ? value[0] : value;

// Session-scoped reads only: never put the owner's private radar in shared cache.
// Paginate explicitly so a large reading list is not silently truncated by REST.
export async function getRadarBooks(supabase: SupabaseClient, userId: string): Promise<RadarBook[]> {
  if (!userId) throw new Error("Authentication required.");
  const books: RadarBook[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase.from("copies")
      .select("id,legacy_id,cover_url,cover_status,work:works!inner(title,author),edition:editions(cover_url),collection:collections!inner(slug,name,owner_id,is_public)")
      .eq("collection.owner_id", userId).eq("reading_status", "radar").eq("published", true)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 199);
    if (error) throw new Error("Unable to load your radar books.", { cause: error });
    const rows = (data ?? []) as unknown as Row[];
    for (const row of rows) {
      const work = first(row.work), collection = first(row.collection), edition = first(row.edition);
      if (!work || !collection) throw new Error("Unable to load your radar books.");
      books.push({ id: row.id, legacyId: row.legacy_id, title: work.title, author: work.author,
        cover: row.cover_status === "cover_not_found" ? DEFAULT_BOOK_COVER : row.cover_url || edition?.cover_url || DEFAULT_BOOK_COVER,
        collectionSlug: collection.slug, collectionName: collection.name, collectionIsPublic: collection.is_public !== false });
    }
    if (rows.length < 200) return books;
  }
}
