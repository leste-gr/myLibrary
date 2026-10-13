import { canonicalIsbn } from "./isbn";

export const MANUAL_GENAI_SCHEMA_VERSION = "mylibrary.shelfie.v1";
export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_BOOKS = 100;

export type ManualGenaiBook = {
  position: number;
  title: string;
  subtitle: string | null;
  authors: string[];
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
    throw new Error("Η απάντηση πρέπει να είναι μικρότερη από 1 MB.");
  }
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  let value: unknown;
  try { value = JSON.parse(fenced ? fenced[1] : trimmed); }
  catch { throw new Error("Δεν βρέθηκε έγκυρο JSON. Επικόλλησε ολόκληρη την απάντηση JSON του chat."); }
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

export const BOOK_IDENTIFICATION_AND_COVER_RESOLUTION = `BOOK IDENTIFICATION AND COVER RESOLUTION

Primary goal: Identify the correct literary work and display a valid cover for it. Matching the exact physical edition is desirable but secondary.

1. Read each spine literally before normalizing the title. Never invent or silently replace uncertain titles.
2. Verify the work using its title, author, series, and volume. Preserve the language of the photographed edition in the catalogue.
3. Resolve covers in this priority order:
   - Exact physical edition.
   - Different edition of the same work in the same language.
   - Different-language edition of the same work.
   - No cover, only when no credible match exists.
4. A representative cover is acceptable even when the publisher, publication year, format, or language differs.
5. Never use the cover of another volume, adaptation, or unrelated work.
6. Never assign an ISBN from a representative cover to the physical edition. Keep ISBN null unless independently verified.
7. Record when a representative cover is used, but do not reduce book-identification confidence solely because the cover differs.
8. Reconcile overlapping photographs and check titles, authors, volumes, and duplicates before importing.
9. Never report an import as fully verified unless its bibliographic validation has actually been completed.

Success criterion: Maximize correct-work identification and cover coverage without introducing false bibliographic information.`;

export const MANDATORY_CLIENT_COVER_SEARCH = `MANDATORY CLIENT-SIDE COVER SEARCH

Before calling this tool, the client MUST actively search for a cover image for EVERY book in the import payload. Searching only selected books and leaving the rest to backend fallback does not satisfy this requirement.

For each book:

1. Search using its title, author, language, and series/volume where applicable.
2. Seek the exact edition first. If unavailable, search for another edition of the same work in the same language, then another language. An exact-edition match or ISBN is NOT required to supply a cover.
3. Verify that the image represents the correct work and volume. Submit a direct public HTTPS image URL in coverUrl.
4. Record representative-cover use and known differences in notes. Never assign the representative edition’s ISBN to the photographed book.
5. Set coverUrl: null only after actively searching and finding no credible cover, or encountering a search/access blocker. Record the searches attempted and the specific unresolved issue in notes. “Backend cover resolution requested” alone is insufficient.

Backend cover resolution is a fallback AFTER client-side searching, never a substitute for it. Do not skip searches because the collection is large; continue in batches until every book has been searched. If search tools are unavailable, disclose the blocker before importing.

FINAL COVER CHECK

Before submitting, confirm that every book has either:

- A verified cover URL for the correct work and volume; or
- A documented unsuccessful search or access blocker.

After importing, report the total number of books, the number of cover URLs supplied by the client, and the number left for backend fallback. Do not imply that backend fallback covers have been found or verified unless confirmed.`;

export const SHELFIE_EXTRACTION_PROTOCOL = `${BOOK_IDENTIFICATION_AND_COVER_RESOLUTION}

${MANDATORY_CLIENT_COVER_SEARCH}

Complete these passes internally before constructing the import:

PASS 1 — PHYSICAL INVENTORY
1. Detect and count every distinct physical spine across all attached photos before extracting metadata.
2. Preserve shelf order: top shelf to bottom shelf and left to right within each shelf. position starts at 1, is consecutive, and is unique.
3. Do not merge neighboring books or split one wide spine. A boxed set visible as one physical object is one item unless its volumes are visibly separate.
4. Keep repeated physical copies as separate items. Use overlapping photos only as additional evidence, not as additional books.

PASS 2 — LITERAL READING
5. Inspect horizontal, vertical, rotated, small, and logo text. Identify title, subtitle, people, publisher/imprint, series, volume/part/issue, edition wording, year, language clues, and any complete visible ISBN.
6. rawVisibleText must preserve all meaningful literal text on the spine in its original script and approximate reading order, before correction or expansion.
7. Do not translate Greek titles into English or English titles into Greek.

PASS 3 — BIBLIOGRAPHIC INTERPRETATION
8. title is the best-supported complete title of this work or volume, not merely the largest word or the series name. Separate a clear secondary title into subtitle.
9. authors contains people responsible for the work, not publishers, series names, or promotional text. Preserve Greek names in Greek and Latin names in Latin when printed that way.
10. You may normalize capitalization, punctuation, spacing, accents, and obvious OCR errors. You may expand a partially read title or name only when at least two independent visible clues support it, such as author plus series, title fragment plus publisher, or title plus volume. Preserve the literal reading in rawVisibleText and explain the correction briefly in notes.
11. If several readings remain plausible, preserve the supported literal title or fragment, lower that field's confidence, and put concise alternatives in notes. Never silently replace an uncertain title. Do not invent a title from an author alone.
12. publisher may be identified from an unmistakable logo. series and volume must be separate from the individual title. Preserve Roman numerals and meaningful issue labels.
13. publicationYear is populated only when a four-digit year is visible. language is the likely language of this physical edition, not the author's nationality.
14. visibleIsbn must be null unless every digit of a complete ISBN-10 or ISBN-13 is visibly readable and checksum-valid.
15. Use [] when no author is supported and null for other unknown fields. Never use placeholders such as "Unknown", "Unreadable", or "Untitled".
16. A meaningful title or title fragment is required. Omit a spine if no such fragment can be detected; mention the omission nowhere outside the JSON.

PASS 4 — WEB VERIFICATION AND COVER
17. After reading the spine literally, verify the literary work using title, author, series, and volume. Prefer a publisher, author, library, or reputable bookshop page. Correct-work identification and credible cover coverage are the primary goal; an exact physical-edition match is secondary.
18. isbn is the canonical ISBN-13 for the independently verified physical edition. Retrieve it only from a credible edition page or catalogue record supported by the photographed book; never guess it or assign the ISBN of a representative cover. Keep isbn null unless independently verified. When a complete visibleIsbn is present, isbn must match it. A representative cover may coexist with an independently verified physical-edition ISBN, but the cover's edition must never replace that ISBN.
19. coverUrl is a direct, public HTTPS URL for a cover image, not a search-results page or product page. Prefer the image declared in schema.org Book/Product data, then og:image or the page's primary product image. Reject placeholders, generic series art, thumbnails too small to identify, access-controlled URLs, data/blob URLs, and images from pages that describe another volume, adaptation, or unrelated work.
20. Resolve covers in order: exact physical edition; another edition of the same work in the same language; a different-language edition of the same work; null only when no credible match exists. A representative cover is acceptable even when publisher, publication year, format, or language differs. Record “representative cover” and the known differences in notes. Preserve the photographed edition's title, language, and other bibliographic fields; never copy conflicting metadata from the cover's edition. Do not reduce book-identification confidence solely because the cover differs.
21. Check that the cover depicts the same work, author, series, and volume and is not an adaptation. Different language or edition details alone do not invalidate a representative cover. Keep the source image URL stable and free of temporary authentication parameters when possible. Leave coverUrl null when no credible match exists so the backend fallback can run.

CONFIDENCE CALIBRATION
- 0.95–1.00: directly and completely readable.
- 0.80–0.94: clear with minor normalization.
- 0.60–0.79: partially obscured but reconstructed from multiple strong clues.
- 0.40–0.59: uncertain but still a meaningful supported reading.
- Below 0.40: normally leave the optional field unknown rather than speculate.
confidence represents confidence that the physical item was separated correctly and its title identifies the book, independently of whether the cover matches the physical edition. fieldConfidence scores each interpreted field; use null when that field is absent.

PASS 5 — FINAL CHECK
22. Reconcile the JSON count with the physical count, check that neighbors were not merged, remove accidental duplicate detections, retain genuine repeated copies, and verify consecutive positions.
23. Confirm every item has a meaningful title, every ISBN is complete and checksum-valid, every coverUrl is a direct public HTTPS image linked to the correct book page, and unknowns use [] or null correctly. Recheck titles, authors, series, and volumes across overlapping photos. Record representative covers and unresolved bibliographic validation in notes. Never report an import as fully verified unless its bibliographic validation has actually been completed; a successful write or a found cover is not proof of validation.`;

export const SHELFIE_GENAI_PROMPT = `You are extracting a physical book inventory from shelf photographs that I attach in this chat.

Return ONLY valid JSON. Do not use Markdown fences and do not add commentary.

${SHELFIE_EXTRACTION_PROTOCOL}

Use this exact schema and field names:
{
  "schemaVersion": "mylibrary.shelfie.v1",
  "books": [
    {
      "position": 1,
      "title": "Required visible title",
      "subtitle": null,
      "authors": [],
      "publisher": null,
      "language": null,
      "publicationYear": null,
      "editionStatement": null,
      "series": null,
      "volume": null,
      "visibleIsbn": null,
      "isbn": null,
      "coverUrl": null,
      "confidence": 0.9,
      "notes": null,
      "rawVisibleText": "Literal text visible on the spine",
      "fieldConfidence": { "title": 0.9, "authors": 0.8, "publisher": null, "series": null, "volume": null }
    }
  ]
}`;
