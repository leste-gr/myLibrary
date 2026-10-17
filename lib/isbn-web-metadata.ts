import { canonicalIsbn } from "./isbn";
import type { IsbnEditionMetadata } from "./isbn-edition";
import { findBookPageUrls } from "./web-book-search";
import { fetchPublicResource } from "./safe-remote-fetch";

function values(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return values((value as Record<string,unknown>).name ?? (value as Record<string,unknown>).value);
  return [];
}
function nodes(value: unknown): Record<string,unknown>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string,unknown>;
  return [node,...nodes(node["@graph"]),...nodes(node.mainEntity),...nodes(node.itemListElement)];
}
function languageCode(value: string | undefined) {
  if (!value) return null;
  return ({eng:"en",english:"en",ell:"el",gre:"el",greek:"el",fre:"fr",fra:"fr",deu:"de",ger:"de"} as Record<string,string>)[value.toLowerCase()] ?? value;
}
export function extractExactIsbnMetadata(html: string, isbn: string): IsbnEditionMetadata | null {
  for (const script of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const node of nodes(JSON.parse(script[1]))) {
        const types = values(node["@type"]);
        if (!types.some(type => /^(Book|Product)$/i.test(type))) continue;
        const identifiers = [node.isbn,node.gtin13,node.gtin,node.productID,node.sku,node.identifier].flatMap(values);
        // Some shops only put the ISBN in this product's description. Never
        // associate a page-wide ISBN or another product's identifier with it.
        for (const description of values(node.description)) {
          for (const match of description.matchAll(/ISBN(?:-1[03])?\s*[:#]?\s*([0-9Xx][0-9Xx \u2010-\u2015-]{8,22})/gi)) identifiers.push(match[1]);
        }
        if (!identifiers.some(value => canonicalIsbn(value) === isbn)) continue;
        const title = values(node.name ?? node.headline)[0]?.trim();
        if (!title) continue;
        return {title,authors:values(node.author),publishers:values(node.publisher),publishedDate:types.includes("Book") ? values(node.datePublished)[0] ?? null : null,language:languageCode(values(node.inLanguage)[0])};
      }
    } catch { /* Ignore malformed blocks, and keep checking other products. */ }
  }
  return null;
}

export async function lookupIsbnWebMetadata(isbn: string, fetcher: typeof fetch = fetch): Promise<IsbnEditionMetadata | null> {
  const urls = (await findBookPageUrls(`"${isbn}"`,fetcher)).slice(0,6);
  const results = await Promise.all(urls.map(async url => {
    try {
      const page = await fetchPublicResource(url,{maxBytes:2*1024*1024,acceptedTypes:type=>type==="text/html"||type==="application/xhtml+xml",timeoutMs:6000,fetcher});
      const metadata = extractExactIsbnMetadata(new TextDecoder().decode(page.bytes),isbn);
      return metadata ? {...metadata,metadataSource:page.finalUrl} : null;
    } catch { return null; }
  }));
  return results.filter((item):item is NonNullable<typeof item>=>item!==null)
    .sort((left,right)=>right.authors.length-left.authors.length)[0] ?? null;
}
