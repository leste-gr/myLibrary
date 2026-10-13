import type { SupabaseClient } from "@supabase/supabase-js";
import { nameSimilarity, normalizedText, textSimilarity } from "./isbn-matcher";
import books from "@/books.json";
import { findVerifiedBookPages } from "./web-book-search";

export type MetadataCoverInput = { copyId: string; title: string; authors: string[]; publisher: string | null; language: string | null; series?: string | null; volume?: string | null };
export type MetadataCoverCandidate = { provider: "legacy-library" | "openlibrary" | "google-books" | "web-page"; providerId: string; sourceUrl: string; sourcePageUrl?: string | null; isbn13?: string | null; title: string; authors: string[]; publisher: string | null; score: number; evidence: string[]; workConfidence?: number | null; editionConfidence?: number | null; coverConfidence?: number | null };
const UNKNOWN_AUTHORS = new Set(["", "αγνωστος", "unknown", "μη αναγνωσμενος", "συλλογικο εργο"]);
const ALLOWED_COVER_HOSTS = new Set(["covers.openlibrary.org", "books.google.com", "books.googleusercontent.com"]);

function usefulAuthors(authors: string[]) { return authors.filter((author) => !UNKNOWN_AUTHORS.has(normalizedText(author))); }
function bestSimilarity(expected: string[], candidates: string[]) { return expected.reduce((best, value) => Math.max(best, ...candidates.map((candidate) => textSimilarity(value, candidate)), 0), 0); }
function bestNameSimilarity(expected: string[], candidates: string[]) { return expected.reduce((best, value) => Math.max(best, ...candidates.map((candidate) => nameSimilarity(value, candidate)), 0), 0); }

function reviewedCatalogueCovers(input: MetadataCoverInput): Omit<MetadataCoverCandidate, "score" | "evidence">[] {
  return books.flatMap((book) => book.cover ? [{
    provider: "legacy-library" as const,
    providerId: book.id,
    sourceUrl: `/${book.cover}`,
    title: book.title,
    authors: book.author ? [book.author] : [],
    publisher: book.publisher ?? null,
  }] : []);
}

export function findReviewedCoverCandidates(input: MetadataCoverInput) {
  const reviewed = reviewedCatalogueCovers(input);
  const titleMatches = rankMetadataCovers(input, reviewed.filter((candidate) => textSimilarity(input.title, candidate.title) >= 0.5));
  if (titleMatches.length) return titleMatches;

  // Stage 1 can confidently transcribe the wrong title from a difficult spine.
  // Recover only when one useful author was read and exactly one reviewed cover
  // in this catalogue belongs to that author. The result remains representative:
  // it does not assign the reviewed record's ISBN or overwrite the imported title.
  const expectedAuthors = usefulAuthors(input.authors);
  if (expectedAuthors.length !== 1) return [];
  const authorMatches = reviewed.filter((candidate) => candidate.authors.some((author) => nameSimilarity(expectedAuthors[0], author) >= 0.85));
  if (authorMatches.length !== 1) return [];
  return [{
    ...authorMatches[0],
    score: 600,
    evidence: ["unique phonetic author match in reviewed catalogue", "representative cover; imported title differs"],
  }];
}

export function rankMetadataCovers(input: MetadataCoverInput, candidates: Omit<MetadataCoverCandidate, "score" | "evidence">[]) {
  const expectedAuthors = usefulAuthors(input.authors);
  const expectedTitle = normalizedText(input.title);
  return candidates.map((candidate) => {
    const title = Math.round(textSimilarity(input.title, candidate.title) * 700);
    const publisher = input.publisher && candidate.publisher ? Math.round(textSimilarity(input.publisher, candidate.publisher) * 180) : 0;
    const author = expectedAuthors.length ? Math.round(bestNameSimilarity(expectedAuthors, candidate.authors) * 120) : 0;
    const score = title + publisher + author;
    const exactTitle = expectedTitle === normalizedText(candidate.title);
    const distinctiveExactTitle = exactTitle && expectedTitle.split(" ").length >= 4;
    const corroborated = publisher >= 150 || author >= 100;
    const evidence = [exactTitle ? "exact normalized title" : title >= 630 ? "near-exact title" : title >= 450 ? "strong title match" : null, publisher >= 150 ? "matching publisher" : null, author >= 100 ? "matching author or transliteration" : null].filter((item): item is string => Boolean(item));
    return { ...candidate, score, evidence, accepted: distinctiveExactTitle || (exactTitle && corroborated) || (title >= 630 && corroborated) || (title >= 450 && author >= 100) };
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
  const reviewedMatches = findReviewedCoverCandidates(input);
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
  const catalogueMatches = rankMetadataCovers(input, raw);
  if (catalogueMatches.length) return catalogueMatches;

  const pages = await findVerifiedBookPages({ title: input.title, authors: usefulAuthors(input.authors), publisher: input.publisher, series: input.series ?? null, volume: input.volume ?? null });
  return pages.map((page) => ({
    provider: "web-page" as const,
    providerId: page.pageUrl,
    sourceUrl: page.imageUrl as string,
    sourcePageUrl: page.pageUrl,
    isbn13: page.isbn13,
    title: page.title ?? input.title,
    authors: page.authors,
    publisher: page.publisher,
    score: Math.round(page.coverConfidence * 1000),
    evidence: page.evidence,
    workConfidence: page.workConfidence,
    editionConfidence: page.editionConfidence,
    coverConfidence: page.coverConfidence,
  }));
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
  const rows = candidates.map((candidate, index) => ({ copy_id: input.copyId, provider: candidate.provider, provider_id: candidate.providerId, source_url: candidate.sourceUrl, source_page_url: candidate.sourcePageUrl ?? null, isbn13: candidate.isbn13 ?? null, title: candidate.title, authors: candidate.authors, publisher: candidate.publisher, score: candidate.score, evidence: candidate.evidence, work_confidence: candidate.workConfidence ?? null, edition_confidence: candidate.editionConfidence ?? null, cover_confidence: candidate.coverConfidence ?? null, selected: index === 0, updated_at: new Date().toISOString() }));
  const { error } = await supabase.from("metadata_cover_candidates").upsert(rows, { onConflict: "copy_id,provider,provider_id" });
  if (error) throw new Error(error.message);
  const selected = candidates[0];
  const titleSimilarity = textSimilarity(input.title, selected.title);
  const authorSimilarity = bestNameSimilarity(usefulAuthors(input.authors), selected.authors);
  const correctionConfidence = Number((1 - (1 - titleSimilarity) * (1 - authorSimilarity)).toFixed(4));
  if (["legacy-library", "web-page"].includes(selected.provider) && normalizedText(input.title) !== normalizedText(selected.title) && titleSimilarity >= 0.6 && authorSimilarity >= 0.85 && correctionConfidence >= 0.9) {
    const { data: copy } = await supabase.from("copies").select("work_id,work:works(title,observed_title,title_resolution_confidence)").eq("id", input.copyId).maybeSingle();
    const work = Array.isArray(copy?.work) ? copy.work[0] : copy?.work;
    if (copy?.work_id && work?.title === input.title && (!work.observed_title || Number(work.title_resolution_confidence ?? 0) < correctionConfidence)) {
      const { error: correctionError } = await supabase.from("works").update({ observed_title: work.observed_title ?? input.title, title: selected.title, title_resolution_source: selected.sourcePageUrl ?? `${selected.provider}:${selected.providerId}`, title_resolution_confidence: correctionConfidence, title_resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", copy.work_id);
      if (correctionError) throw new Error(correctionError.message);
    }
  }
  const coverConfidence = Number(Math.min(1, selected.score / 1000).toFixed(4));
  const { data: asset, error: assetError } = await supabase.from("cover_assets").upsert({
    canonical_key: `metadata:${input.copyId}:${selected.provider}:${selected.providerId}`,
    source_type: "metadata",
    source_url: `/api/covers/metadata/${input.copyId}`,
    source_page_url: selected.sourcePageUrl ?? null,
    provider: selected.provider,
    provider_record_id: selected.providerId,
    evidence: selected.evidence,
    work_confidence: selected.workConfidence ?? coverConfidence,
    edition_confidence: selected.editionConfidence ?? null,
    cover_confidence: selected.coverConfidence ?? coverConfidence,
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
  const { data: copies, error: copiesError } = await supabase.from("copies").select("id,cover_url,volume,work:works(series),edition:editions(isbn13)").in("id", copyIds).is("cover_url", null).eq("edition_verification_state", "unresolved");
  if (copiesError) throw new Error(copiesError.message);
  const unresolved = new Map((copies ?? []).filter((copy) => { const edition = Array.isArray(copy.edition) ? copy.edition[0] : copy.edition; return !edition?.isbn13; }).map((copy) => [copy.id, copy]));
  return (data ?? []).filter((row) => unresolved.has(row.copy_id as string)).map((row) => {
    const copy = unresolved.get(row.copy_id as string); const work = Array.isArray(copy?.work) ? copy.work[0] : copy?.work;
    return { copyId: row.copy_id as string, title: row.title_text ?? "", authors: String(row.author_text ?? "").split(",").map((value: string) => value.trim()).filter(Boolean), publisher: row.publisher_text, language: row.language_hint, series: work?.series ?? null, volume: copy?.volume ?? null };
  });
}

