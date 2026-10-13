import { canonicalIsbn } from "./isbn";
import { nameSimilarity, normalizedText, textSimilarity } from "./isbn-matcher";

export type BookPageSearchInput = { title: string; authors: string[]; publisher: string | null; series: string | null; volume: string | null };
export type ExtractedBookPage = { title: string | null; authors: string[]; publisher: string | null; isbn13: string | null; imageUrl: string | null; structuredType: string | null };
export type VerifiedBookPage = ExtractedBookPage & { pageUrl: string; workConfidence: number; editionConfidence: number; coverConfidence: number; evidence: string[]; accepted: boolean };

function quoted(value: string | null | undefined) { return value?.trim() ? `"${value.trim().replaceAll('"', "")}"` : ""; }

export function buildBookPageSearchQueries(input: BookPageSearchInput) {
  const author = quoted(input.authors[0]);
  const relaxedTitle = input.title.replace(/[":;,()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
  const queries = [
    [quoted(input.title), "ISBN"],
    [quoted(input.title), author, quoted(input.publisher)],
    [quoted(input.title), author, "εξώφυλλο"],
    [relaxedTitle, author, quoted(input.publisher)],
  ];
  if (input.series || input.volume) queries.push([quoted(input.series), quoted(input.volume), quoted(input.publisher)]);
  return queries.map((parts) => parts.filter(Boolean).join(" ")).filter((query, index, all) => query && all.indexOf(query) === index);
}

function values(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return values(item.name ?? item.url ?? item.contentUrl);
  }
  return [];
}

function schemaNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(schemaNodes);
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [node, ...schemaNodes(node["@graph"]), ...schemaNodes(node.mainEntity), ...schemaNodes(node.itemListElement)];
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  return patterns.map((pattern) => pattern.exec(html)?.[1]).find(Boolean) ?? null;
}

export function extractBookPage(html: string): ExtractedBookPage {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const nodes = schemaNodes(JSON.parse(script[1]));
      const node = nodes.find((item) => values(item["@type"]).some((type) => ["book", "product"].includes(normalizedText(type))));
      if (!node) continue;
      const rawIsbn = values(node.isbn ?? node.productID ?? node.sku).find((value) => canonicalIsbn(value));
      return {
        title: values(node.name ?? node.headline)[0] ?? null,
        authors: values(node.author),
        publisher: values(node.publisher ?? node.brand)[0] ?? null,
        isbn13: rawIsbn ? canonicalIsbn(rawIsbn) : null,
        imageUrl: values(node.image)[0] ?? null,
        structuredType: values(node["@type"])[0] ?? null,
      };
    } catch { /* Ignore malformed JSON-LD and try the next block. */ }
  }
  return {
    title: meta(html, "og:title"),
    authors: [],
    publisher: meta(html, "book:publisher") ?? meta(html, "og:site_name"),
    isbn13: null,
    imageUrl: meta(html, "og:image"),
    structuredType: null,
  };
}

export function verifyBookPage(input: BookPageSearchInput, pageUrl: string, extracted: ExtractedBookPage): VerifiedBookPage {
  const title = textSimilarity(input.title, extracted.title);
  const author = input.authors.length && extracted.authors.length ? Math.max(...input.authors.flatMap((expected) => extracted.authors.map((candidate) => nameSimilarity(expected, candidate)))) : 0;
  const publisher = input.publisher && extracted.publisher ? textSimilarity(input.publisher, extracted.publisher) : 0;
  const authorConflict = input.authors.length > 0 && extracted.authors.length > 0 && author < 0.35;
  const workConfidence = Number(Math.min(1, title * 0.75 + (input.authors.length ? author * 0.25 : title * 0.25)).toFixed(4));
  const editionConfidence = Number(Math.min(1, workConfidence * 0.65 + publisher * 0.2 + (extracted.isbn13 ? 0.15 : 0)).toFixed(4));
  const coverConfidence = Number(Math.min(1, workConfidence * 0.8 + (extracted.imageUrl ? 0.1 : 0) + (extracted.structuredType ? 0.1 : 0)).toFixed(4));
  const distinctiveExactTitle = title === 1 && normalizedText(input.title).split(" ").length >= 4;
  const authorBackedCorrection = title >= 0.6 && author >= 0.85;
  const accepted = Boolean(extracted.imageUrl) && !authorConflict && (authorBackedCorrection || (title >= 0.8 && (author >= 0.7 || publisher >= 0.75 || distinctiveExactTitle)));
  const evidence = [title === 1 ? "exact normalized title" : title >= 0.8 ? "near-exact title" : title >= 0.6 ? "plausible title correction" : null, author >= 0.85 ? "strong matching author or transliteration" : author >= 0.7 ? "matching author" : null, publisher >= 0.75 ? "matching publisher" : null, extracted.structuredType ? `schema.org ${extracted.structuredType}` : null, extracted.isbn13 ? "structured ISBN" : null].filter((value): value is string => Boolean(value));
  return { ...extracted, pageUrl, workConfidence, editionConfidence, coverConfidence, evidence, accepted };
}
