import { buildBookPageSearchQueries, extractBookPage, verifyBookPage, type BookPageSearchInput, type VerifiedBookPage } from "./book-page-extractor";
import { fetchPublicResource } from "./safe-remote-fetch";

const SEARCH_ENDPOINT = "https://www.bing.com/search";
const MAX_HTML_BYTES = 2 * 1024 * 1024;

function decodeXml(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

export function parseBingRssLinks(xml: string) {
  return [...xml.matchAll(/<item\b[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter((value, index, all) => {
      try { const url = new URL(value); return url.protocol === "https:" && url.hostname !== "www.bing.com" && all.indexOf(value) === index; } catch { return false; }
    });
}

async function search(query: string, fetcher: typeof fetch) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  url.searchParams.set("count", "8");
  const response = await fetcher(url, { headers: { Accept: "application/rss+xml, application/xml;q=0.9", "User-Agent": "myLibrary-book-discovery/1.0" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok) return [];
  return parseBingRssLinks(await response.text());
}

export async function findVerifiedBookPages(input: BookPageSearchInput, fetcher: typeof fetch = fetch) {
  const queries = buildBookPageSearchQueries(input).slice(0, 3);
  const resultLists = await Promise.all(queries.map((query) => search(query, fetcher).catch(() => [])));
  const urls = [...new Set(resultLists.flat())].slice(0, 10);
  const verified: VerifiedBookPage[] = [];
  for (const pageUrl of urls) {
    try {
      const page = await fetchPublicResource(pageUrl, {
        maxBytes: MAX_HTML_BYTES,
        acceptedTypes: (type) => type === "text/html" || type === "application/xhtml+xml",
        headers: { Accept: "text/html", "User-Agent": "myLibrary-book-discovery/1.0" },
        timeoutMs: 10_000,
        fetcher,
      });
      const extracted = extractBookPage(new TextDecoder().decode(page.bytes));
      if (extracted.imageUrl) extracted.imageUrl = new URL(extracted.imageUrl, page.finalUrl).toString();
      const candidate = verifyBookPage(input, page.finalUrl, extracted);
      if (candidate.accepted) verified.push(candidate);
    } catch { /* Search results are untrusted and failures are isolated. */ }
  }
  return verified.sort((left, right) => right.coverConfidence - left.coverConfidence || right.editionConfidence - left.editionConfidence).slice(0, 5);
}
