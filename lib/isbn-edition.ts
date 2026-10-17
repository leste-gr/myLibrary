import { canonicalIsbn } from "./isbn";
import { lookupIsbnWebMetadata } from "./isbn-web-metadata";

export type IsbnEditionMetadata = {
  metadataSource?: string;
  title: string | null;
  authors: string[];
  publishers: string[];
  publishedDate: string | null;
  language: string | null;
};
type Fetcher = typeof fetch;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const texts = (value: unknown) => Array.isArray(value) ? value.map(text).filter((item): item is string => item !== null) : [];
const names = (value: unknown) => Array.isArray(value) ? texts(value.map(item => item?.name)) : [];

// Exact identifier lookup: text-search results must never replace a chosen ISBN.
export async function lookupIsbnEdition(isbn: string, fetcher: Fetcher = fetch): Promise<IsbnEditionMetadata> {
  const read = async (url: URL) => {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(8000), cache: "no-store", headers: { Accept: "application/json" } });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  };
  const ol = new URL("https://openlibrary.org/api/books");
  ol.searchParams.set("bibkeys", `ISBN:${isbn}`); ol.searchParams.set("format", "json"); ol.searchParams.set("jscmd", "data");
  const google = new URL("https://www.googleapis.com/books/v1/volumes");
  google.searchParams.set("q", `isbn:${isbn}`); google.searchParams.set("maxResults", "5");
  if (process.env.GOOGLE_BOOKS_API_KEY) google.searchParams.set("key", process.env.GOOGLE_BOOKS_API_KEY);
  const [openLibrary, googleBooks] = await Promise.all([read(ol), read(google)]);
  const record = openLibrary?.[`ISBN:${isbn}`];
  const items = Array.isArray(googleBooks?.items) ? googleBooks.items : [];
  const volume = items.find((item: { volumeInfo?: { industryIdentifiers?: { identifier?: string }[] } }) =>
    Array.isArray(item?.volumeInfo?.industryIdentifiers) && item.volumeInfo.industryIdentifiers.some(identifier => canonicalIsbn(identifier.identifier ?? "") === isbn))?.volumeInfo;
  const authors = names(record?.authors);
  const publishers = names(record?.publishers);
  const metadata: IsbnEditionMetadata = {
    title: text(record?.title) ?? text(volume?.title),
    authors: authors.length ? authors : texts(volume?.authors),
    publishers: publishers.length ? publishers : texts(volume?.publisher ? [volume.publisher] : []),
    publishedDate: text(record?.publish_date) ?? text(volume?.publishedDate),
    language: text(volume?.language),
  };
  if (!metadata.title) return await lookupIsbnWebMetadata(isbn, fetcher) ?? metadata;
  return metadata;
}
