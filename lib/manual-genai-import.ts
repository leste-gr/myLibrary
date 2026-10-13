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

export const SHELFIE_EXTRACTION_PROTOCOL = `Complete these passes internally before constructing the import:

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
11. If several readings remain plausible, choose the most likely, lower that field's confidence, and put concise alternatives in notes. Do not invent a title from an author alone.
12. publisher may be identified from an unmistakable logo. series and volume must be separate from the individual title. Preserve Roman numerals and meaningful issue labels.
13. publicationYear is populated only when a four-digit year is visible. language is the likely language of this physical edition, not the author's nationality.
14. visibleIsbn must be null unless every digit of a complete ISBN-10 or ISBN-13 is visibly readable and checksum-valid. Never retrieve, infer, or guess an ISBN from bibliographic knowledge.
15. Use [] when no author is supported and null for other unknown fields. Never use placeholders such as "Unknown", "Unreadable", or "Untitled".
16. A meaningful title or title fragment is required. Omit a spine if no such fragment can be detected; mention the omission nowhere outside the JSON.

CONFIDENCE CALIBRATION
- 0.95–1.00: directly and completely readable.
- 0.80–0.94: clear with minor normalization.
- 0.60–0.79: partially obscured but reconstructed from multiple strong clues.
- 0.40–0.59: uncertain but still a meaningful supported reading.
- Below 0.40: normally leave the optional field unknown rather than speculate.
confidence represents confidence that the physical item was separated correctly and its title identifies the book. fieldConfidence scores each interpreted field; use null when that field is absent.

PASS 4 — FINAL CHECK
17. Reconcile the JSON count with the physical count, check that neighbors were not merged, remove accidental duplicate detections, retain genuine repeated copies, and verify consecutive positions.
18. Confirm every item has a meaningful title, every visibleIsbn is complete and valid, and unknowns use [] or null correctly.`;

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
      "confidence": 0.9,
      "notes": null,
      "rawVisibleText": "Literal text visible on the spine",
      "fieldConfidence": { "title": 0.9, "authors": 0.8, "publisher": null, "series": null, "volume": null }
    }
  ]
}`;
