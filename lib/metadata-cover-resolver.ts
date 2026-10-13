import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizedText, textSimilarity } from "./isbn-matcher";
import books from "@/books.json";

export type MetadataCoverInput = { copyId: string; title: string; authors: string[]; publisher: string | null; language: string | null };
export type MetadataCoverCandidate = { provider: "legacy-library" | "openlibrary" | "google-books"; providerId: string; sourceUrl: string; title: string; authors: string[]; publisher: string | null; score: number; evidence: string[] };
const UNKNOWN_AUTHORS = new Set(["", "αγνωστος", "unknown", "μη αναγνωσμενος", "συλλογικο εργο"]);
const ALLOWED_COVER_HOSTS = new Set(["covers.openlibrary.org", "books.google.com", "books.googleusercontent.com"]);

function usefulAuthors(authors: string[]) { return authors.filter((author) => !UNKNOWN_AUTHORS.has(normalizedText(author))); }
function bestSimilarity(expected: string[], candidates: string[]) { return expected.reduce((best, value) => Math.max(best, ...candidates.map((candidate) => textSimilarity(value, candidate)), 0), 0); }

export function rankMetadataCovers(input: MetadataCoverInput, candidates: Omit<MetadataCoverCandidate, "score" | "evidence">[]) {
  const expectedAuthors = usefulAuthors(input.authors);
  const expectedTitle = normalizedText(input.title);
  return candidates.map((candidate) => {
    const title = Math.round(textSimilarity(input.title, candidate.title) * 700);
    const publisher = input.publisher && candidate.publisher ? Math.round(textSimilarity(input.publisher, candidate.publisher) * 180) : 0;
    const author = expectedAuthors.length ? Math.round(bestSimilarity(expectedAuthors, candidate.authors) * 120) : 0;
    const score = title + publisher + author;
    const exactTitle = expectedTitle === normalizedText(candidate.title);
    const distinctiveExactTitle = exactTitle && expectedTitle.split(" ").length >= 4;
    const corroborated = publisher >= 150 || author >= 100;
    const evidence = [exactTitle ? "exact normalized title" : title >= 630 ? "near-exact title" : title >= 490 ? "strong title match" : null, publisher >= 150 ? "matching publisher" : null, author >= 100 ? "matching author" : null].filter((item): item is string => Boolean(item));
    return { ...candidate, score, evidence, accepted: distinctiveExactTitle || (exactTitle && corroborated) || (title >= 630 && corroborated) };
  }).filter((candidate) => candidate.accepted)
    .sort((left, right) => right.score - left.score || left.providerId.localeCompare(right.providerId))
    .slice(0, 5)
    .map(({ accepted: _accepted, ...candidate }) => candidate);
}

async function fetchJson<T>(url: URL, attempts = 3): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "myLibrary-metadata-cover/1.0" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
      if (response.ok) return response.json() as Promise<T>;
      if (response.status !== 429 && response.status < 500) return null;
    } catch { /* retry transient provider failures */ }
    await new Promise((resolve) => setTimeout(resolve, 750 * (2 ** attempt)));
  }
  return null;
}

export async function findMetadataCoverCandidates(input: MetadataCoverInput) {
  const reviewed: Omit<MetadataCoverCandidate, "score" | "evidence">[] = books.flatMap((book) => book.cover && textSimilarity(input.title, book.title) >= 0.5 ? [{
    provider: "legacy-library" as const,
    providerId: book.id,
    sourceUrl: `/${book.cover}`,
    title: book.title,
    authors: book.author ? [book.author] : [],
    publisher: book.publisher ?? null,
  }] : []);
  const reviewedMatches = rankMetadataCovers(input, reviewed);
  if (reviewedMatches.length) return reviewedMatches;

  const raw: Omit<MetadataCoverCandidate, "score" | "evidence">[] = [];
  const openLibrary = new URL("https://openlibrary.org/search.json");
  openLibrary.searchParams.set("title", input.title);
  openLibrary.searchParams.set("limit", "10");
  openLibrary.searchParams.set("fields", "key,title,author_name,publisher,cover_i");
  const openPayload = await fetchJson<{ docs?: { key?: string; title?: string; author_name?: string[]; publisher?: string[]; cover_i?: number }[] }>(openLibrary);
  for (const doc of openPayload?.docs ?? []) if (doc.cover_i && doc.title) raw.push({ provider: "openlibrary", providerId: String(doc.cover_i), sourceUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`, title: doc.title, authors: doc.author_name ?? [], publisher: doc.publisher?.[0] ?? null });

  const google = new URL("https://www.googleapis.com/books/v1/volumes");
  google.searchParams.set("q", `intitle:"${input.title.replaceAll('"', '')}"`);
  google.searchParams.set("maxResults", "20");
  google.searchParams.set("printType", "books");
  google.searchParams.set("fields", "items(id,volumeInfo(title,authors,publisher,imageLinks))");
  const googlePayload = await fetchJson<{ items?: { id?: string; volumeInfo?: { title?: string; authors?: string[]; publisher?: string; imageLinks?: Record<string, string> } }[] }>(google);
  for (const item of googlePayload?.items ?? []) {
    const info = item.volumeInfo; const image = info?.imageLinks?.extraLarge ?? info?.imageLinks?.large ?? info?.imageLinks?.medium ?? info?.imageLinks?.thumbnail ?? info?.imageLinks?.smallThumbnail;
    if (!item.id || !info?.title || !image) continue;
    try { const source = new URL(image.replace(/^http:/, "https:")); if (!ALLOWED_COVER_HOSTS.has(source.hostname)) continue; source.searchParams.set("zoom", "2"); raw.push({ provider: "google-books", providerId: item.id, sourceUrl: source.toString(), title: info.title, authors: info.authors ?? [], publisher: info.publisher ?? null }); } catch { /* invalid provider URL */ }
  }
  return rankMetadataCovers(input, raw);
}

export async function resolveMetadataCover(supabase: SupabaseClient, input: MetadataCoverInput) {
  const candidates = await findMetadataCoverCandidates(input);
  await supabase.from("metadata_cover_candidates").update({ selected: false, updated_at: new Date().toISOString() }).eq("copy_id", input.copyId);
  if (!candidates.length) {
    await supabase.from("metadata_cover_candidates").delete().eq("copy_id", input.copyId);
    await supabase.from("copy_cover_selections").delete().eq("copy_id", input.copyId).eq("usage_scope", "representative").eq("decision_source", "algorithm");
    await supabase.from("copies").update({ cover_url: null, cover_source: null, updated_at: new Date().toISOString() }).eq("id", input.copyId).is("edition_id", null).eq("edition_verification_state", "unresolved");
    return false;
  }
  const rows = candidates.map((candidate, index) => ({ copy_id: input.copyId, provider: candidate.provider, provider_id: candidate.providerId, source_url: candidate.sourceUrl, title: candidate.title, authors: candidate.authors, publisher: candidate.publisher, score: candidate.score, evidence: candidate.evidence, selected: index === 0, updated_at: new Date().toISOString() }));
  const { error } = await supabase.from("metadata_cover_candidates").upsert(rows, { onConflict: "copy_id,provider,provider_id" });
  if (error) throw new Error(error.message);
  const selected = candidates[0];
  const coverConfidence = Number(Math.min(1, selected.score / 1000).toFixed(4));
  const { data: asset, error: assetError } = await supabase.from("cover_assets").upsert({
    canonical_key: `metadata:${input.copyId}:${selected.provider}:${selected.providerId}`,
    source_type: "metadata",
    source_url: `/api/covers/metadata/${input.copyId}`,
    provider: selected.provider,
    provider_record_id: selected.providerId,
    evidence: selected.evidence,
    work_confidence: coverConfidence,
    cover_confidence: coverConfidence,
    verification_status: "provisional",
  }, { onConflict: "canonical_key" }).select("id").single();
  if (assetError || !asset) throw new Error(assetError?.message || "Could not create cover asset.");
  const { error: selectionError } = await supabase.from("copy_cover_selections").upsert({ copy_id: input.copyId, cover_asset_id: asset.id, usage_scope: "representative", decision_source: "algorithm", selected_at: new Date().toISOString() }, { onConflict: "copy_id" });
  if (selectionError) throw new Error(selectionError.message);
  const { error: copyError } = await supabase.from("copies").update({ cover_url: `/api/cover-assets/${asset.id}`, cover_source: "cover-asset", updated_at: new Date().toISOString() }).eq("id", input.copyId).is("edition_id", null).eq("edition_verification_state", "unresolved");
  if (copyError) throw new Error(copyError.message);
  return true;
}

export async function unresolvedMetadataCoverInputs(supabase: SupabaseClient, importId?: string) {
  let query = supabase.from("book_observations").select("copy_id,title_text,author_text,publisher_text,language_hint").not("copy_id", "is", null);
  if (importId) query = query.eq("manual_genai_import_id", importId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const copyIds = [...new Set((data ?? []).map((row) => row.copy_id as string))];
  if (!copyIds.length) return [];
  const { data: copies, error: copiesError } = await supabase.from("copies").select("id,cover_url,edition:editions(isbn13)").in("id", copyIds).is("cover_url", null).eq("edition_verification_state", "unresolved");
  if (copiesError) throw new Error(copiesError.message);
  const unresolved = new Set((copies ?? []).filter((copy) => { const edition = Array.isArray(copy.edition) ? copy.edition[0] : copy.edition; return !edition?.isbn13; }).map((copy) => copy.id));
  return (data ?? []).filter((row) => unresolved.has(row.copy_id as string)).map((row) => ({ copyId: row.copy_id as string, title: row.title_text ?? "", authors: String(row.author_text ?? "").split(",").map((value: string) => value.trim()).filter(Boolean), publisher: row.publisher_text, language: row.language_hint }));
}

