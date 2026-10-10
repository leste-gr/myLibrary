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

function requiredTitle(value: unknown, index: number): string {
  const title = optionalText(value, "title", index);
  if (!title) throw new Error(`Book ${index}: title is required.`);
  return title;
}

export function parseManualGenaiImport(value: unknown): ManualGenaiImport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The JSON root must be an object.");
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== MANUAL_GENAI_SCHEMA_VERSION) throw new Error(`schemaVersion must be ${MANUAL_GENAI_SCHEMA_VERSION}.`);
  if (!Array.isArray(root.books) || root.books.length < 1 || root.books.length > MAX_IMPORT_BOOKS) {
    throw new Error(`books must contain between 1 and ${MAX_IMPORT_BOOKS} items.`);
  }
  const positions = new Set<number>();
  const books = root.books.map((entry, offset): ManualGenaiBook => {
    const index = offset + 1;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Book ${index} must be an object.`);
    const book = entry as Record<string, unknown>;
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
    return {
      position: Number(position),
      title: requiredTitle(book.title, index),
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
    };
  });
  books.sort((left, right) => left.position - right.position);
  return { schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books };
}

export const SHELFIE_GENAI_PROMPT = `You are extracting a physical book inventory from shelf photographs that I attach in this chat.

Return ONLY valid JSON. Do not use Markdown fences and do not add commentary.

Rules:
1. Create exactly one item per distinct physical book spine. Do not merge neighboring books. A boxed set visible as one physical item is one item.
2. Preserve shelf order: top shelf to bottom shelf, and left to right within each shelf. position starts at 1 and must be unique.
3. Transcribe what is visible. You may normalize obvious OCR spacing, but do not invent missing bibliographic facts.
4. visibleIsbn must be null unless a complete ISBN-10 or ISBN-13 is visibly readable in the image. Never guess an ISBN from a title.
5. Use [] when no author is visible. Use null for other unknown fields.
6. confidence is your confidence that this item is one correctly separated physical book and that its title is correct, from 0 to 1.
7. If a spine is unreadable, still include it with the best short title fragment and explain the uncertainty in notes.
8. Include repeated copies as separate items.

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
      "notes": null
    }
  ]
}`;
