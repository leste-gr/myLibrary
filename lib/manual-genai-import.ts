import { normalizeCategoryTags } from "./category-tags";
import { canonicalIsbn } from "./isbn";

export const MANUAL_GENAI_SCHEMA_VERSION = "mylibrary.shelfie.v1";
export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_BOOKS = 100;

export type ManualGenaiBook = {
  position: number;
  title: string;
  subtitle: string | null;
  authors: string[];
  categories?: string[];
  publisher: string | null;
  language: string | null;
  publicationYear: number | null;
  editionStatement: string | null;
  series: string | null;
  volume: string | null;
  visibleIsbn: string | null;
  isbn: string | null;
  coverUrl: string | null;
  confidence: number;
  notes: string | null;
  rawVisibleText: string | null;
  fieldConfidence: {
    title: number | null;
    authors: number | null;
    publisher: number | null;
    series: number | null;
    volume: number | null;
  };
};

export type ManualGenaiImport = {
  schemaVersion: typeof MANUAL_GENAI_SCHEMA_VERSION;
  books: ManualGenaiBook[];
};

/** Accept JSON copied from a chat, including a single Markdown code block.
 * Never guess at prose, repair malformed JSON, or discard invalid book fields. */
export function parseManualGenaiText(text: string): ManualGenaiImport {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("The response must be smaller than 1 MB.");
  }
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  let value: unknown;
  try { value = JSON.parse(fenced ? fenced[1] : trimmed); }
  catch { throw new Error("No valid JSON found. Paste the complete JSON response from your chat."); }
  return parseManualGenaiImport(value);
}

function optionalText(value: unknown, field: string, index: number, maxLength = 300): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`Book ${index}: ${field} must be text or null.`);
  const result = value.trim();
  if (!result) return null;
  if (result.length > maxLength) throw new Error(`Book ${index}: ${field} is too long.`);
  return result;
}

function optionalConfidence(value: unknown, field: string, index: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Book ${index}: fieldConfidence.${field} must be between 0 and 1 or null.`);
  return value;
}

function optionalPublicCoverUrl(value: unknown, index: number): string | null {
  const raw = optionalText(value, "coverUrl", index, 2048);
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error(`Book ${index}: coverUrl must be a valid public HTTPS URL.`); }
  const hostname = url.hostname.toLowerCase();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  const privateIpv4 = ipv4 && (
    Number(ipv4[1]) === 10 || Number(ipv4[1]) === 127 ||
    (Number(ipv4[1]) === 169 && Number(ipv4[2]) === 254) ||
    (Number(ipv4[1]) === 172 && Number(ipv4[2]) >= 16 && Number(ipv4[2]) <= 31) ||
    (Number(ipv4[1]) === 192 && Number(ipv4[2]) === 168)
  );
  if (url.protocol !== "https:" || url.username || url.password || hostname === "localhost" || hostname.endsWith(".local") || privateIpv4 || hostname === "[::1]") {
    throw new Error(`Book ${index}: coverUrl must be a valid public HTTPS URL.`);
  }
  return url.toString();
}

export function parseManualGenaiImport(value: unknown): ManualGenaiImport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The JSON root must be an object.");
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== MANUAL_GENAI_SCHEMA_VERSION) throw new Error(`schemaVersion must be ${MANUAL_GENAI_SCHEMA_VERSION}.`);
  if (!Array.isArray(root.books) || root.books.length < 1 || root.books.length > MAX_IMPORT_BOOKS) {
    throw new Error(`books must contain between 1 and ${MAX_IMPORT_BOOKS} items.`);
  }
  const positions = new Set<number>();
  const books = root.books.flatMap((entry, offset): ManualGenaiBook[] => {
    const index = offset + 1;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Book ${index} must be an object.`);
    const book = entry as Record<string, unknown>;
    const title = optionalText(book.title, "title", index);
    // A detected spine is not a book-information record until it has a title.
    // Skip it before validating or persisting any of its other metadata.
    if (!title) return [];
    const fieldConfidence = book.fieldConfidence === null || book.fieldConfidence === undefined ? {} : book.fieldConfidence;
    if (!fieldConfidence || typeof fieldConfidence !== "object" || Array.isArray(fieldConfidence)) throw new Error(`Book ${index}: fieldConfidence must be an object or null.`);
    const confidence = fieldConfidence as Record<string, unknown>;
    const position = book.position;
    if (!Number.isInteger(position) || Number(position) < 1 || Number(position) > MAX_IMPORT_BOOKS) throw new Error(`Book ${index}: position must be a positive integer.`);
    if (positions.has(Number(position))) throw new Error(`Book ${index}: position ${position} is duplicated.`);
    positions.add(Number(position));
    if (!Array.isArray(book.authors) || book.authors.length > 10 || book.authors.some((author) => typeof author !== "string" || !author.trim() || author.trim().length > 160)) {
      throw new Error(`Book ${index}: authors must be an array of at most 10 names.`);
    }
    if (typeof book.confidence !== "number" || !Number.isFinite(book.confidence) || book.confidence < 0 || book.confidence > 1) {
      throw new Error(`Book ${index}: confidence must be between 0 and 1.`);
    }
    const publicationYear = book.publicationYear;
    if (publicationYear !== null && publicationYear !== undefined && (!Number.isInteger(publicationYear) || Number(publicationYear) < 1400 || Number(publicationYear) > 2100)) {
      throw new Error(`Book ${index}: publicationYear must be a four-digit year or null.`);
    }
    const rawIsbn = optionalText(book.visibleIsbn, "visibleIsbn", index, 32);
    const visibleIsbn = rawIsbn ? canonicalIsbn(rawIsbn) : null;
    if (rawIsbn && !visibleIsbn) throw new Error(`Book ${index}: visibleIsbn is not a valid ISBN-10 or ISBN-13.`);
    const rawResolvedIsbn = optionalText(book.isbn, "isbn", index, 32);
    const isbn = rawResolvedIsbn ? canonicalIsbn(rawResolvedIsbn) : null;
    if (rawResolvedIsbn && !isbn) throw new Error(`Book ${index}: isbn is not a valid ISBN-10 or ISBN-13.`);
    if (visibleIsbn && isbn && visibleIsbn !== isbn) throw new Error(`Book ${index}: isbn and visibleIsbn must identify the same edition.`);
    return [{
      position: Number(position),
      title,
      subtitle: optionalText(book.subtitle, "subtitle", index),
      authors: book.authors.map((author) => String(author).trim()),
      ...(book.categories === undefined ? {} : { categories: normalizeCategoryTags(book.categories) }),
      publisher: optionalText(book.publisher, "publisher", index, 200),
      language: optionalText(book.language, "language", index, 40),
      publicationYear: publicationYear === null || publicationYear === undefined ? null : Number(publicationYear),
      editionStatement: optionalText(book.editionStatement, "editionStatement", index, 160),
      series: optionalText(book.series, "series", index, 200),
      volume: optionalText(book.volume, "volume", index, 80),
      visibleIsbn,
      isbn,
      coverUrl: optionalPublicCoverUrl(book.coverUrl, index),
      confidence: book.confidence,
      notes: optionalText(book.notes, "notes", index, 500),
      rawVisibleText: optionalText(book.rawVisibleText, "rawVisibleText", index, 1000),
      fieldConfidence: {
        title: optionalConfidence(confidence.title, "title", index),
        authors: optionalConfidence(confidence.authors, "authors", index),
        publisher: optionalConfidence(confidence.publisher, "publisher", index),
        series: optionalConfidence(confidence.series, "series", index),
        volume: optionalConfidence(confidence.volume, "volume", index),
      },
    }];
  });
  if (books.length === 0) throw new Error("At least one book with a title is required.");
  books.sort((left, right) => left.position - right.position);
  return { schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books };
}

export const SHELFIE_EXTRACTION_PROTOCOL = `CRITICAL: MANDATORY COVER SEARCH AND COMPLETION GATE

Cover discovery is a required deliverable, not an optional enhancement.

The task is NOT complete when the books have been identified. It is complete only when every identified book has undergone an individual, client-side cover search and the resulting JSON has been validated.

PHASE 1 — Inventory

1. Identify all physical books in the photographs.
2. Construct the complete inventory with bibliographic metadata.
3. Count the books and assign consecutive positions.
4. Do not generate the final downloadable file yet.

PHASE 2 — Mandatory web searches

YOU MUST INVOKE WEB SEARCH TOOLS. Do not rely exclusively on internal knowledge or backend cover resolution.

For EVERY book in the inventory:

1. Search the web using the book’s title and author.
2. Search for the exact edition, prioritizing the photographed language.
3. If unsuccessful, search other editions of the same work.
4. Search publisher websites, bookstores, Google Books, Open Library, and image search results as appropriate.
5. Extract a direct HTTPS image URL, not a product-page URL.
6. Verify that the image corresponds to the correct work and volume.
7. Assign the verified URL to coverUrl.
8. If no suitable cover is found, document the actual searches and their outcomes in notes.

Do not stop after searching a subset of the books.

Search in batches if necessary. Continue until every book has been processed.

PHASE 3 — Search audit

Maintain an internal audit table with the following information for EVERY book:

* Position and title
* Search performed: YES/NO
* Search queries used
* Sources examined
* Cover URL found: YES/NO
* URL verified: YES/NO
* Reason for failure, if applicable

Before proceeding, assert:

booksSearched === totalBooks

If this condition is false, continue searching.

A null coverUrl is acceptable only when a real search was attempted and the failure is documented.

Never invent URLs, search results, or verification outcomes.

PHASE 4 — Completion validation

Before generating the JSON file, calculate:

* totalBooks: Number of physical books identified
* booksSearched: Number of books individually searched
* coversFound: Number of verified direct cover URLs
* coversMissing: Number of books without verified covers

The following conditions MUST hold:

booksSearched === totalBooks

coversFound + coversMissing === totalBooks

Every book with a null coverUrl MUST have documented search attempts in its notes.

If any condition fails, do not generate the final file. Continue the unfinished work.

PHASE 5 — Deliverable

Generate the complete JSON file using the requested schema.

Use a real file-generation tool and provide a working download link. Do not invent sandbox paths.

After generating the file, verify that it exists, is valid JSON, contains all identified books, and passes the completion checks.

If web search tools are unavailable or searches are blocked, explicitly report the limitation. Do not claim that the searches were performed.

IMPORTANT: Never substitute a promise to search later, a metadata-only JSON file, or backend cover fallback for the mandatory client-side search. Do not report completion unless the required searches actually occurred.`;

export const SHELFIE_GENAI_PROMPT = `You are extracting a physical book inventory from shelf photographs that I attach in this chat.

Return ONLY valid JSON. Do not use Markdown fences and do not add commentary.

${SHELFIE_EXTRACTION_PROTOCOL}

Supply categories as 1–8 concise category tags in English, based on the title, author, series and subject. Combine format/genre/subject where supported (e.g. ["Fiction", "Fantasy"] or ["Tabletop Roleplaying", "Game Adventures", "Fantasy"]). Distinguish novels from game manuals and graphic adaptations. Do not infer genres from a vague title alone; use ["Uncategorized"] if no supported category can be established.

Use this exact schema and field names:
{
  "schemaVersion": "mylibrary.shelfie.v1",
  "books": [
    {
      "position": 1,
      "title": "Required visible title",
      "subtitle": null,
      "authors": [],
      "categories": ["Fiction", "Fantasy"],
      "publisher": null,
      "language": null,
      "publicationYear": null,
      "editionStatement": null,
      "series": null,
      "volume": null,
      "coverUrl": null,
      "confidence": 0.9,
      "notes": null,
      "rawVisibleText": "Literal text visible on the spine",
      "fieldConfidence": { "title": 0.9, "authors": 0.8, "publisher": null, "series": null, "volume": null }
    }
  ]
}`;
