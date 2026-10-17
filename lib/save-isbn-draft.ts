import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupIsbnEdition, type IsbnEditionMetadata } from "./isbn-edition";

type Candidate = { authors?: string[]; language?: string | null; id: string; title: string | null; publishers: string[]; published_date: string | null };
export async function saveIsbnDraft(supabase: SupabaseClient, copyId: string, isbn: string, candidate?: Candidate,
  lookup = lookupIsbnEdition) {
  const [{ data: edition, error }, matched] = await Promise.all([
    supabase.from("editions").select("title,publishers,published_date,language,metadata,provider").eq("isbn13", isbn).maybeSingle(),
    lookup(isbn),
  ]);
  if (error) throw new Error(error.message);
  const cached = (edition?.metadata ?? {}) as Partial<IsbnEditionMetadata>;
  const trustedCache = edition?.provider !== "manual" || Boolean(cached.metadataSource);
  const metadata: IsbnEditionMetadata = {
    title: matched.title ?? candidate?.title ?? (trustedCache ? cached.title ?? edition?.title : null) ?? null,
    authors: matched.authors.length ? matched.authors : Array.isArray(cached.authors) && cached.authors.length ? cached.authors : candidate?.authors ?? [],
    publishers: matched.publishers.length ? matched.publishers : edition?.publishers?.length ? edition.publishers : candidate?.publishers ?? [],
    publishedDate: matched.publishedDate ?? edition?.published_date ?? candidate?.published_date ?? null,
    language: matched.language ?? edition?.language ?? candidate?.language ?? null,
    ...(matched.title ? {metadataSource:matched.metadataSource ?? "isbn-provider"} : cached.metadataSource ? {metadataSource:cached.metadataSource} : {}),
  };
  const { error: draftError } = await supabase.rpc("save_owned_isbn_draft", {
    target_copy_id: copyId, target_isbn: isbn, edition_metadata: metadata, target_candidate_id: candidate?.id ?? null,
  });
  if (draftError) throw new Error(draftError.message);
}
