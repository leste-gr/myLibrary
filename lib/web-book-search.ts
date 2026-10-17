import { buildBookPageSearchQueries, extractBookPage, verifyBookPage, type BookPageSearchInput, type VerifiedBookPage } from "./book-page-extractor";
import { fetchPublicResource } from "./safe-remote-fetch";
import { ProviderUnavailableError } from "./provider-error";

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

export function parseDuckDuckGoLinks(html: string) {
  return [...html.matchAll(/<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => decodeXml(match[1]))
    .map((value) => {
      try {
        const url = new URL(value, "https://duckduckgo.com");
        if (url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/") return url.searchParams.get("uddg") ?? "";
        return url.toString();
      } catch { return ""; }
    })
    .filter((value, index, all) => {
      try { const url = new URL(value); return url.protocol === "https:" && !url.hostname.endsWith("duckduckgo.com") && all.indexOf(value) === index; } catch { return false; }
    });
}

async function search(query: string, fetcher: typeof fetch) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  url.searchParams.set("count", "8");
  const response = await fetcher(url, { headers: { Accept: "application/rss+xml, application/xml;q=0.9", "User-Agent": "myLibrary-book-discovery/1.0" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok && response.status !== 404) throw new ProviderUnavailableError(`Bing returned ${response.status}.`);
  if (!response.ok) return [];
  return parseBingRssLinks(await response.text());
}

async function searchDuckDuckGo(query: string, fetcher: typeof fetch) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetcher(url, { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; myLibrary-book-discovery/1.0)" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (response.status === 202 || (!response.ok && response.status !== 404)) throw new ProviderUnavailableError(`DuckDuckGo returned ${response.status}.`);
  if (!response.ok) return [];
  return parseDuckDuckGoLinks(await response.text());
}

export async function findBookPageUrls(query: string, fetcher: typeof fetch = fetch) {
  const results = await Promise.allSettled([searchDuckDuckGo(query, fetcher), search(query, fetcher)]);
  return [...new Set(results.flatMap(result => result.status === "fulfilled" ? result.value : []))];
}

export async function findVerifiedBookPages(input: BookPageSearchInput, fetcher: typeof fetch = fetch) {
  const queries = buildBookPageSearchQueries(input).slice(0, 4);
  const searches = await Promise.allSettled(queries.flatMap((query) => [searchDuckDuckGo(query, fetcher), search(query, fetcher)]));
  let providerFailed = searches.some(result => result.status === "rejected");
  const resultLists = searches.flatMap(result => result.status === "fulfilled" ? result.value : []);
  const urls = [...new Set(resultLists)].slice(0, 16);
  async function inspect(pageUrl: string) {
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
      return candidate.accepted ? candidate : null;
    } catch (error) {
      if (error instanceof ProviderUnavailableError) providerFailed = true;
      return null; // Rejected or irrelevant result pages are not cover misses.
    }
  }
  const verified: VerifiedBookPage[] = [];
  for (let offset = 0; offset < urls.length; offset += 4) {
    const batch = await Promise.all(urls.slice(offset, offset + 4).map(inspect));
    verified.push(...batch.filter((candidate): candidate is VerifiedBookPage => Boolean(candidate)));
  }
  if (!verified.length && providerFailed) throw new ProviderUnavailableError("Web cover search incomplete due to provider failure.");
  return verified.sort((left, right) => right.coverConfidence - left.coverConfidence || right.editionConfidence - left.editionConfidence).slice(0, 5);
}
