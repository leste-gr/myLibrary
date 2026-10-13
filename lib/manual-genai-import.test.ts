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
    isbn: "9780261102217",
    coverUrl: "https://images.example.test/the-hobbit.jpg",
    confidence: 0.92,
    notes: null,
    rawVisibleText: "THE HOBBIT TOLKIEN",
    fieldConfidence: { title: 0.95, authors: 0.8, publisher: null, series: null, volume: null },
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
  assert.equal(parsed.books[0].isbn, "9780261102217");
  assert.equal(parsed.books[0].coverUrl, "https://images.example.test/the-hobbit.jpg");
  assert.equal(parsed.books[0].rawVisibleText, "THE HOBBIT TOLKIEN");
  assert.equal(parsed.books[0].fieldConfidence.title, 0.95);
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
  assert.throws(
    () => parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: [book({ visibleIsbn: null, isbn: "9780000000000" })] }),
    /isbn/,
  );
  assert.throws(
    () => parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: [book({ coverUrl: "http://localhost/cover.jpg" })] }),
    /coverUrl/,
  );
});

test("skips title-less records and requires at least one titled book", () => {
  const parsed = parseManualGenaiImport({
    schemaVersion: MANUAL_GENAI_SCHEMA_VERSION,
    books: [book({ title: "" }), book({ position: 2, title: "Dune", visibleIsbn: null })],
  });
  assert.deepEqual(parsed.books.map((item) => item.title), ["Dune"]);
  assert.throws(() => parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: [book({ title: null })] }), /At least one book with a title/);
});

test("still requires an authors array for titled books", () => {
  assert.throws(
    () => parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: [book({ authors: null })] }),
    /authors/,
  );
});
