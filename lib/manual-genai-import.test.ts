import assert from "node:assert/strict";
import test from "node:test";
import { MANUAL_GENAI_SCHEMA_VERSION, parseManualGenaiImport } from "./manual-genai-import";

function book(overrides: Record<string, unknown> = {}) {
  return {
    position: 1,
    title: "  The Hobbit  ",
    subtitle: null,
    authors: ["  J. R. R. Tolkien "],
    publisher: null,
    language: "en",
    publicationYear: 1937,
    editionStatement: null,
    series: null,
    volume: null,
    visibleIsbn: "0-261-10221-4",
    confidence: 0.92,
    notes: null,
    ...overrides,
  };
}

test("normalizes, canonicalizes, and sorts a valid import", () => {
  const parsed = parseManualGenaiImport({
    schemaVersion: MANUAL_GENAI_SCHEMA_VERSION,
    books: [book({ position: 2, title: "Second", visibleIsbn: null }), book()],
  });

  assert.deepEqual(parsed.books.map((item) => item.position), [1, 2]);
  assert.equal(parsed.books[0].title, "The Hobbit");
  assert.deepEqual(parsed.books[0].authors, ["J. R. R. Tolkien"]);
  assert.equal(parsed.books[0].visibleIsbn, "9780261102217");
});

test("rejects an unsupported schema", () => {
  assert.throws(
    () => parseManualGenaiImport({ schemaVersion: "future", books: [book()] }),
    /schemaVersion/,
  );
});

test("rejects duplicate positions", () => {
  assert.throws(
    () => parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: [book(), book()] }),
    /duplicated/,
  );
});

test("rejects invalid confidence and ISBN values", () => {
  assert.throws(
    () => parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: [book({ confidence: 1.1 })] }),
    /confidence/,
  );
  assert.throws(
    () => parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: [book({ visibleIsbn: "9780000000000" })] }),
    /visibleIsbn/,
  );
});

test("requires a title and an authors array", () => {
  assert.throws(
    () => parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: [book({ title: "" })] }),
    /title/,
  );
  assert.throws(
    () => parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: [book({ authors: null })] }),
    /authors/,
  );
});
