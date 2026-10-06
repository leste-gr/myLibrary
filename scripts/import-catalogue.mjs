import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
if (process.argv.includes("--dry-run")) {
  const dryBooks = await readJson("../books.json");
  const dryMapping = await readJson("../data/isbn-mapping.json");
  const dryIsbns = await readJson("../isbn.json");
  const ids = new Set(dryBooks.map((book) => book.id));
  if (ids.size !== dryBooks.length) throw new Error("Duplicate copy IDs in books.json.");
  if (Object.keys(dryIsbns).some((id) => !ids.has(id))) throw new Error("ISBN mapping references an unknown copy.");
  console.log(JSON.stringify({
    works: dryBooks.length,
    editions: Object.keys(dryIsbns).length,
    copies: dryBooks.length,
    candidates: dryMapping.books.reduce((total, item) => total + item.candidates.length, 0),
  }));
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const books = await readJson("../books.json");
const mapping = await readJson("../data/isbn-mapping.json");
const acceptedIsbns = await readJson("../isbn.json");
const mappingById = new Map(mapping.books.map((item) => [item.copyId, item]));

function coverUrl(candidate) {
  const coverId = (candidate?.coverIds ?? []).find((value) => Number(value) > 0);
  if (coverId) return "https://covers.openlibrary.org/b/id/" + coverId + "-L.jpg";
  return candidate?.isbn13 ? "https://covers.openlibrary.org/b/isbn/" + candidate.isbn13 + "-L.jpg" : null;
}

function assertResult(result, label) {
  if (result.error) throw new Error(label + ": " + result.error.message);
  return result.data;
}

const workRows = books.map((book) => ({
  external_key: "legacy:" + book.id,
  title: book.title,
  author: book.author,
  contributors: book.contributors,
  series: book.series || null,
  subseries: book.subseries,
  updated_at: new Date().toISOString(),
}));
const works = assertResult(
  await supabase.from("works").upsert(workRows, { onConflict: "external_key" }).select("id,external_key"),
  "Import works",
);
const workIdByLegacy = new Map(works.map((work) => [work.external_key.replace("legacy:", ""), work.id]));

const editionRows = Object.entries(acceptedIsbns).map(([copyId, isbn13]) => {
  const item = mappingById.get(copyId);
  const candidate = item?.candidates.find((value) => value.isbn13 === isbn13);
  return {
    isbn13,
    title: candidate?.title ?? item?.title ?? null,
    publishers: candidate?.publishers ?? (candidate?.publisher ? [candidate.publisher] : []),
    published_date: candidate?.publishDate ?? null,
    cover_url: coverUrl(candidate),
    provider: candidate?.provider ?? null,
    provider_id: candidate?.providerId ?? null,
    metadata: { evidence: candidate?.evidence ?? [], importedFrom: copyId },
    updated_at: new Date().toISOString(),
  };
});
const editions = assertResult(
  await supabase.from("editions").upsert(editionRows, { onConflict: "isbn13" }).select("id,isbn13"),
  "Import accepted editions",
);
const editionIdByIsbn = new Map(editions.map((edition) => [edition.isbn13, edition.id]));

const copyRows = books.map((book, index) => ({
  legacy_id: book.id,
  work_id: workIdByLegacy.get(book.id),
  edition_id: acceptedIsbns[book.id] ? editionIdByIsbn.get(acceptedIsbns[book.id]) : null,
  display_order: index + 1,
  category: book.category,
  language: book.language,
  volume: book.volume,
  publisher: book.publisher,
  notes: book.notes,
  cover_url: book.cover ? "/" + book.cover : null,
  cover_source: book.coverSource,
  published: true,
  updated_at: new Date().toISOString(),
}));
const copies = assertResult(
  await supabase.from("copies").upsert(copyRows, { onConflict: "legacy_id" }).select("id,legacy_id"),
  "Import copies",
);
const copyIdByLegacy = new Map(copies.map((copy) => [copy.legacy_id, copy.id]));

const candidateRows = mapping.books.flatMap((item) =>
  item.candidates.map((candidate, rank) => ({
    copy_id: copyIdByLegacy.get(item.copyId),
    isbn13: candidate.isbn13,
    title: candidate.title ?? null,
    publishers: candidate.publishers ?? (candidate.publisher ? [candidate.publisher] : []),
    published_date: candidate.publishDate ?? null,
    cover_url: coverUrl(candidate),
    provider: candidate.provider,
    provider_id: candidate.providerId,
    score: candidate.score ?? 0,
    suggested: candidate.isbn13 === item.suggestedIsbn13,
    rank: rank + 1,
    evidence: candidate.evidence ?? [],
  })),
);

for (let offset = 0; offset < candidateRows.length; offset += 250) {
  assertResult(
    await supabase.from("edition_candidates").upsert(candidateRows.slice(offset, offset + 250), {
      onConflict: "copy_id,isbn13",
    }),
    "Import candidate batch",
  );
}

console.log(JSON.stringify({
  works: workRows.length,
  editions: editionRows.length,
  copies: copyRows.length,
  candidates: candidateRows.length,
}));
