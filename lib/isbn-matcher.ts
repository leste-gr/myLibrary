import { canonicalIsbn } from "./isbn";

export type IsbnMatchInput = {
  title: string;
  authors: string[];
  publisher: string | null;
  publicationYear: number | null;
  language: string | null;
  series: string | null;
};

export type RankedIsbnCandidate = {
  isbn13: string;
  title: string | null;
  authors: string[];
  publishers: string[];
  publishedDate: string | null;
  language: string | null;
  providerId: string;
  score: number;
  confidence: number;
  rank: number;
  evidence: string[];
  scoreBreakdown: Record<string, number>;
  providerCount: number;
};

export type ProviderCandidate = Omit<RankedIsbnCandidate, "score" | "confidence" | "rank" | "evidence" | "scoreBreakdown" | "providerCount"> & {
  provider: "openlibrary" | "google-books";
};

type ProviderResult = { records: ProviderCandidate[]; failed: boolean };

const UNKNOWN_AUTHORS = new Set(["", "άγνωστος", "unknown", "μη αναγνωσμένος", "συλλογικό έργο"]);
const USER_AGENT = "myLibrary-isbn-matcher/1.0 (+https://github.com/leste-gr/myLibrary)";
let googleRetryAfter = 0;

export function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function textSimilarity(leftValue: unknown, rightValue: unknown) {
  const left = normalizedText(leftValue);
  const right = normalizedText(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = union ? intersection / union : 0;
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(jaccard, containment * 0.9);
}

function usefulAuthors(authors: string[]) {
  return authors.map(normalizedText).filter((author) => !UNKNOWN_AUTHORS.has(author));
}

function bestSimilarity(expected: string[], candidates: string[]) {
  return expected.reduce((best, expectedValue) => Math.max(best, ...candidates.map((candidate) => textSimilarity(expectedValue, candidate)), 0), 0);
}

function yearFrom(value: string | null) {
  const match = value?.match(/\b(1[4-9]\d{2}|20\d{2}|2100)\b/);
  return match ? Number(match[1]) : null;
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}.`);
  return response.json() as Promise<T>;
}

async function openLibraryCandidates(input: IsbnMatchInput): Promise<ProviderResult> {
  try {
    const url = new URL("https://openlibrary.org/search.json");
    if (input.series) {
      const cleanTitle = input.title.replaceAll('"', "");
      const cleanSeries = input.series.replaceAll('"', "");
      url.searchParams.set("q", `title:"${cleanTitle}" "${cleanSeries}"`);
    } else {
      url.searchParams.set("title", input.title);
    }
    const authors = usefulAuthors(input.authors);
    if (authors[0]) url.searchParams.set("author", authors[0]);
    url.searchParams.set("limit", "10");
    url.searchParams.set("fields", "key,title,author_name,isbn,publisher,first_publish_year,language");
    const payload = await fetchJson<{ docs?: Array<{ key?: string; title?: string; author_name?: string[]; isbn?: string[]; publisher?: string[]; first_publish_year?: number; language?: string[] }> }>(url);
    const records: ProviderCandidate[] = [];
    for (const document of payload.docs ?? []) {
      for (const rawIsbn of (document.isbn ?? []).slice(0, 40)) {
        const isbn13 = canonicalIsbn(rawIsbn);
        if (!isbn13) continue;
        records.push({
          isbn13,
          title: document.title ?? null,
          authors: document.author_name ?? [],
          publishers: document.publisher ?? [],
          publishedDate: document.first_publish_year ? String(document.first_publish_year) : null,
          language: document.language?.[0] ?? null,
          provider: "openlibrary",
          providerId: document.key?.split("/").pop() ?? isbn13,
        });
      }
    }
    return { records, failed: false };
  } catch {
    return { records: [], failed: true };
  }
}

async function googleBooksCandidates(input: IsbnMatchInput): Promise<ProviderResult> {
  if (Date.now() < googleRetryAfter) return { records: [], failed: true };
  try {
    const terms = [`intitle:"${input.title}"`];
    const authors = usefulAuthors(input.authors);
    if (authors[0]) terms.push(`inauthor:"${authors[0]}"`);
    if (input.series) terms.push(`"${input.series}"`);
    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    url.searchParams.set("q", terms.join(" "));
    url.searchParams.set("maxResults", "20");
    url.searchParams.set("printType", "books");
    url.searchParams.set("fields", "items(id,volumeInfo(title,authors,publisher,publishedDate,language,industryIdentifiers))");
    const payload = await fetchJson<{ items?: Array<{ id?: string; volumeInfo?: { title?: string; authors?: string[]; publisher?: string; publishedDate?: string; language?: string; industryIdentifiers?: Array<{ identifier?: string }> } }> }>(url);
    const records: ProviderCandidate[] = [];
    for (const item of payload.items ?? []) {
      const info = item.volumeInfo;
      if (!info) continue;
      for (const identifier of info.industryIdentifiers ?? []) {
        const isbn13 = canonicalIsbn(identifier.identifier ?? "");
        if (!isbn13) continue;
        records.push({
          isbn13,
          title: info.title ?? null,
          authors: info.authors ?? [],
          publishers: info.publisher ? [info.publisher] : [],
          publishedDate: info.publishedDate ?? null,
          language: info.language ?? null,
          provider: "google-books",
          providerId: item.id ?? isbn13,
        });
      }
    }
    return { records, failed: false };
  } catch {
    googleRetryAfter = Date.now() + 60_000;
    return { records: [], failed: true };
  }
}

export function rankIsbnCandidates(input: IsbnMatchInput, records: ProviderCandidate[], limit = 10): RankedIsbnCandidate[] {
  const grouped = new Map<string, ProviderCandidate[]>();
  for (const record of records) grouped.set(record.isbn13, [...(grouped.get(record.isbn13) ?? []), record]);
  const expectedAuthors = usefulAuthors(input.authors);
  const ranked = [...grouped.entries()].map(([isbn13, isbnRecords]) => {
    const scored = isbnRecords.map((record) => {
      const title = Math.round(textSimilarity(input.title, record.title) * 500);
      const author = Math.round(bestSimilarity(expectedAuthors, record.authors) * 250);
      const publisher = input.publisher ? Math.round(bestSimilarity([input.publisher], record.publishers) * 100) : 0;
      const publicationYear = input.publicationYear && yearFrom(record.publishedDate) === input.publicationYear ? 75 : 0;
      const language = input.language && record.language && normalizedText(input.language) === normalizedText(record.language) ? 25 : 0;
      const series = input.series ? Math.round(textSimilarity(input.series, `${record.title ?? ""} ${record.publishers.join(" ")}`) * 150) : 0;
      return { record, breakdown: { title, author, publisher, publicationYear, language, series }, metadataScore: title + author + publisher + publicationYear + language + series };
    }).sort((left, right) => right.metadataScore - left.metadataScore);
    const best = scored[0];
    const providers = new Set(isbnRecords.map((record) => record.provider));
    const providerAgreement = providers.size > 1 ? 100 : 0;
    const score = best.metadataScore + providerAgreement;
    const evidence = [
      best.breakdown.title >= 450 ? "exact or near-exact normalized title" : best.breakdown.title >= 250 ? "similar normalized title" : null,
      best.breakdown.author >= 225 ? "exact or near-exact normalized author" : best.breakdown.author >= 125 ? "similar normalized author" : null,
      best.breakdown.publisher >= 90 ? "exact or near-exact publisher" : null,
      best.breakdown.publicationYear ? "matching publication year" : null,
      providerAgreement ? "multiple providers agree on ISBN" : null,
    ].filter((value): value is string => Boolean(value));
    return {
      isbn13,
      title: best.record.title,
      authors: best.record.authors,
      publishers: best.record.publishers,
      publishedDate: best.record.publishedDate,
      language: best.record.language,
      providerId: [...new Set(isbnRecords.map((record) => `${record.provider}:${record.providerId}`))].slice(0, 4).join(","),
      score,
      confidence: 0,
      rank: 0,
      evidence,
      scoreBreakdown: { ...best.breakdown, providerAgreement },
      providerCount: providers.size,
    };
  }).sort((left, right) => right.score - left.score || left.isbn13.localeCompare(right.isbn13)).slice(0, limit);

  const leader = ranked[0]?.score ?? 0;
  const runnerUp = ranked[1]?.score ?? 0;
  return ranked.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    confidence: Number(Math.min(1, Math.max(0, (candidate.score / 950) * 0.75 + (index === 0 ? Math.max(0, leader - runnerUp) / 500 * 0.25 : 0))).toFixed(4)),
  }));
}

export async function findIsbnCandidates(input: IsbnMatchInput) {
  const title = normalizedText(input.title);
  if (!title || title.length < 3 || title.includes("unreadable") || title.includes("unknown") || title.includes("illegible") || input.title.includes("…")) {
    return { candidates: [], providerFailures: 0 };
  }
  const results = await Promise.all([openLibraryCandidates(input), googleBooksCandidates(input)]);
  return {
    candidates: rankIsbnCandidates(input, results.flatMap((result) => result.records)),
    providerFailures: results.filter((result) => result.failed).length,
  };
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
