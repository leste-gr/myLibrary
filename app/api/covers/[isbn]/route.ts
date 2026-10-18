import { canonicalIsbn } from "@/lib/isbn";

export const runtime = "nodejs";

const SUCCESS_CACHE = "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";
const MISS_CACHE = "public, max-age=300, s-maxage=3600";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Cover = { bytes: ArrayBuffer; contentType: string; source: string };
type CoverResult = { cover: Cover | null; transientFailure: boolean };

async function fetchImage(url: string, source: string): Promise<CoverResult> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Shelfie Street-cover-resolver/1.0" },
      next: { revalidate: 2592000 },
    });
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok) return { cover: null, transientFailure: response.status !== 404 && response.status !== 410 };
    if (!contentType.startsWith("image/") || declaredLength > MAX_IMAGE_BYTES) return { cover: null, transientFailure: false };
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return { cover: null, transientFailure: false };
    return { cover: { bytes, contentType, source }, transientFailure: false };
  } catch {
    return { cover: null, transientFailure: true };
  }
}

async function googleBooksCover(isbn: string): Promise<{ url: string | null; transientFailure: boolean }> {
  try {
    const endpoint = new URL("https://www.googleapis.com/books/v1/volumes");
    endpoint.searchParams.set("q", `isbn:${isbn}`);
    endpoint.searchParams.set("maxResults", "1");
    endpoint.searchParams.set("fields", "items(volumeInfo/imageLinks)");
    if (process.env.GOOGLE_BOOKS_API_KEY) endpoint.searchParams.set("key", process.env.GOOGLE_BOOKS_API_KEY);
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 2592000 },
    });
    if (!response.ok) return { url: null, transientFailure: response.status !== 404 && response.status !== 410 };
    const payload = await response.json() as { items?: { volumeInfo?: { imageLinks?: Record<string, string> } }[] };
    const links = payload.items?.[0]?.volumeInfo?.imageLinks;
    const cover = links?.extraLarge ?? links?.large ?? links?.medium ?? links?.thumbnail ?? links?.smallThumbnail;
    if (!cover) return { url: null, transientFailure: false };
    const url = new URL(cover.replace(/^http:/, "https:"));
    if (!new Set(["books.google.com", "books.googleusercontent.com"]).has(url.hostname)) return { url: null, transientFailure: false };
    url.searchParams.set("zoom", "2");
    return { url: url.toString(), transientFailure: false };
  } catch {
    return { url: null, transientFailure: true };
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
  const google = openLibrary.cover ? { url: null, transientFailure: false } : await googleBooksCover(isbn);
  const googleImage = google.url ? await fetchImage(google.url, "google-books") : { cover: null, transientFailure: false };
  const cover = openLibrary.cover ?? googleImage.cover;
  if (!cover) {
    if (openLibrary.transientFailure || google.transientFailure || googleImage.transientFailure) {
      return new Response("Cover providers temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } });
    }
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
