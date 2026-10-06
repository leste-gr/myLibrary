import { canonicalIsbn } from "@/lib/isbn";
import books from "@/books.json";
import acceptedIsbns from "@/isbn.json";

export const runtime = "nodejs";

const SUCCESS_CACHE = "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";
const MISS_CACHE = "public, max-age=300, s-maxage=3600";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Cover = { bytes: ArrayBuffer; contentType: string; source: string };

const legacyCoverByIsbn = new Map(
  Object.entries(acceptedIsbns as Record<string, string>).flatMap(([copyId, isbn]) => {
    const book = books.find((item) => item.id === copyId);
    return book?.cover ? [[isbn, `/${book.cover}`] as const] : [];
  }),
);

async function fetchImage(url: string, source: string): Promise<Cover | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "myLibrary-cover-resolver/1.0" },
      next: { revalidate: 2592000 },
    });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || !contentType.startsWith("image/") || declaredLength > MAX_IMAGE_BYTES) return null;
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return { bytes, contentType, source };
  } catch {
    return null;
  }
}

async function googleBooksCover(isbn: string): Promise<string | null> {
  try {
    const endpoint = new URL("https://www.googleapis.com/books/v1/volumes");
    endpoint.searchParams.set("q", `isbn:${isbn}`);
    endpoint.searchParams.set("maxResults", "1");
    endpoint.searchParams.set("fields", "items(volumeInfo/imageLinks)");
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 2592000 },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { items?: { volumeInfo?: { imageLinks?: Record<string, string> } }[] };
    const links = payload.items?.[0]?.volumeInfo?.imageLinks;
    const cover = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.thumbnail ?? links?.smallThumbnail;
    if (!cover) return null;
    const url = new URL(cover.replace(/^http:/, "https:"));
    if (!new Set(["books.google.com", "books.googleusercontent.com"]).has(url.hostname)) return null;
    url.searchParams.set("zoom", "2");
    return url.toString();
  } catch {
    return null;
  }
}

function missingCover(isbn: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="600" height="900" fill="#eee8dc"/><text x="300" y="420" text-anchor="middle" font-family="serif" font-size="32" fill="#6d6255">Cover unavailable</text><text x="300" y="470" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#8a7d6d">ISBN ${isbn}</text></svg>`;
  return new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml", "Cache-Control": MISS_CACHE, "X-Cover-Source": "placeholder" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ isbn: string }> }) {
  const isbn = canonicalIsbn((await params).isbn);
  if (!isbn || isbn.length !== 13) return new Response("Invalid ISBN", { status: 400 });

  const openLibrary = await fetchImage(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, "openlibrary");
  const googleUrl = openLibrary ? null : await googleBooksCover(isbn);
  const cover = openLibrary ?? (googleUrl ? await fetchImage(googleUrl, "google-books") : null);
  if (!cover) {
    const legacyCover = legacyCoverByIsbn.get(isbn);
    if (legacyCover) return new Response(null, { status: 307, headers: { Location: new URL(legacyCover, request.url).toString(), "Cache-Control": SUCCESS_CACHE, "X-Cover-Source": "legacy-library" } });
    return missingCover(isbn);
  }

  return new Response(cover.bytes, {
    headers: {
      "Content-Type": cover.contentType,
      "Content-Length": String(cover.bytes.byteLength),
      "Cache-Control": SUCCESS_CACHE,
      "X-Cover-Source": cover.source,
    },
  });
}
