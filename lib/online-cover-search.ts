import sharp from "sharp";
import { findMetadataCoverCandidates, type MetadataCoverCandidate, type MetadataCoverInput } from "./metadata-cover-resolver";
import { findVerifiedBookPages } from "./web-book-search";
import { fetchPublicResource } from "./safe-remote-fetch";
import { nameSimilarity, normalizedText } from "./isbn-matcher";
import { ProviderUnavailableError } from "./provider-error";
import { MAX_COVER_UPLOAD_BYTES } from "./book-cover";

export type VerifiedCover = { coverUrl: string; sourcePageUrl: string | null; evidence: Record<string, unknown> };
function number(value: string) {
  const token = value.trim().replace(/^(?:vol(?:ume)?\.?|book|part|issue|τομος|τευχος|μερος|#)\s*/i, "");
  if (/^\d+$/.test(token)) return String(Number(token));
  if (!/^[ivxlcdm]+$/i.test(token)) return null;
  const digits: Record<string, number> = { i:1,v:5,x:10,l:50,c:100,d:500,m:1000 };
  const roman = token.toLowerCase();
  return String([...roman].reduce((sum,char,index) => sum + (digits[char] < (digits[roman[index+1]] ?? 0) ? -digits[char] : digits[char]),0));
}
function titleVolume(title: string) {
  return title.match(/(?:\b(?:vol(?:ume)?\.?|book|part|issue|τομος|τευχος|μερος)\s*|#)(\d+|[ivxlcdm]+)\b/i)?.[1]
    ?? title.match(/(?:^|\s)(\d+)\s*$/)?.[1] ?? null;
}
export function suitableCoverCandidate(input: MetadataCoverInput, candidate: MetadataCoverCandidate) {
  const authors = input.authors.filter(author => !["", "unknown", "αγνωστος", "συλλογικο εργο"].includes(normalizedText(author)));
  if (authors.length && candidate.authors.length && Math.max(...authors.flatMap(author => candidate.authors.map(other => nameSimilarity(author,other)))) < .35) return false;
  const expected = input.volume?.trim() || titleVolume(input.title);
  if (!expected) return true;
  const actual = titleVolume(candidate.title);
  if (number(expected) !== null) {
    const candidateNumbers = normalizedText(candidate.title).split(" ").filter(token => /^\d+$/.test(token));
    return actual ? number(actual) === number(expected) : candidateNumbers.some(token => number(token) === number(expected));
  }
  return normalizedText(candidate.title).includes(normalizedText(expected));
}

type SearchOptions = {
  find?: typeof findMetadataCoverCandidates;
  webSearch?: typeof findVerifiedBookPages;
  fetcher?: typeof fetch;
  resolveAddresses?: (hostname: string) => Promise<string[]>;
};
export async function findVerifiedCover(input: MetadataCoverInput, signal: AbortSignal, options: SearchOptions = {}): Promise<VerifiedCover | null> {
  const fetcher: typeof fetch = (url, init) => (options.fetcher ?? fetch)(url, { ...init,
    signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
  const candidates = await (options.find ?? findMetadataCoverCandidates)(input, { signal, fetcher });
  let providerFailure: unknown;
  async function inspect(list: MetadataCoverCandidate[]) {
    for (const candidate of list) {
      signal.throwIfAborted();
      if (!suitableCoverCandidate(input,candidate)) continue;
      try {
        const image = await fetchPublicResource(candidate.sourceUrl, {
          maxBytes: MAX_COVER_UPLOAD_BYTES, acceptedTypes: type => ["image/jpeg","image/png","image/webp"].includes(type),
          timeoutMs: 8000, fetcher, resolveAddresses: options.resolveAddresses,
        });
        const decoder = sharp(Buffer.from(image.bytes), { limitInputPixels: 40_000_000, failOn: "warning" });
        const metadata = await decoder.metadata();
        if ((metadata.width ?? 0) < 80 || (metadata.height ?? 0) < 100) continue;
        const stats = await decoder.stats(); // Decode as well as checking HTTP headers; reject blank placeholders.
        if (stats.entropy < .05) continue;
        signal.throwIfAborted();
        return { coverUrl: image.finalUrl, sourcePageUrl: candidate.sourcePageUrl ?? null,
          evidence: { provider: candidate.provider, providerId: candidate.providerId, matchedTitle: candidate.title,
            matchedAuthors: candidate.authors, score: candidate.score, evidence: candidate.evidence,
            queryTitle: input.title, queryAuthors: input.authors, volume: input.volume ?? null,
            imageVerified: true, width: metadata.width, height: metadata.height } };
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ProviderUnavailableError) providerFailure = error;
      }
    }
    return null;
  }
  const matched = await inspect(candidates);
  if (matched) return matched;
  // A catalogue match with a dead image must not prevent trying other web pages.
  if (candidates.some(candidate => candidate.provider !== "web-page")) {
    const pages = await (options.webSearch ?? findVerifiedBookPages)({ title: input.title, authors: input.authors,
      publisher: input.publisher, series: input.series ?? null, volume: input.volume ?? null },fetcher);
    const fallback = await inspect(pages.map(page => ({ provider: "web-page", providerId: page.pageUrl,
      sourceUrl: page.imageUrl!, sourcePageUrl: page.pageUrl, title: page.title ?? input.title,
      authors: page.authors, publisher: page.publisher, score: Math.round(page.coverConfidence*1000), evidence: page.evidence })));
    if (fallback) return fallback;
  }
  signal.throwIfAborted();
  if (providerFailure) throw providerFailure;
  return null;
}
