import assert from "node:assert/strict";
import test from "node:test";
import { rankMetadataCovers } from "./metadata-cover-resolver";

test("metadata cover ranking accepts a strong title and publisher match without an ISBN", () => {
  const ranked = rankMetadataCovers({ copyId: "B038", title: "Η απελευθέρωση της Γης και άλλα διηγήματα", authors: ["Συλλογικό έργο"], publisher: "Παρά Πέντε", language: "el" }, [
    { provider: "google-books", providerId: "right", sourceUrl: "https://books.google.com/right", title: "Η απελευθέρωση της Γης και άλλα διηγήματα", authors: [], publisher: "Παρά Πέντε" },
    { provider: "openlibrary", providerId: "wrong", sourceUrl: "https://covers.openlibrary.org/wrong", title: "Η Γη", authors: [], publisher: "Άλλος" },
  ]);
  assert.equal(ranked.length, 1); assert.equal(ranked[0].providerId, "right"); assert.ok(ranked[0].evidence.includes("exact normalized title"));
});

test("metadata cover ranking rejects uncorroborated partial and short-title matches", () => {
  const ranked = rankMetadataCovers({ copyId: "x", title: "Dragon: Hunting", authors: [], publisher: null, language: "en" }, [
    { provider: "openlibrary", providerId: "wrong", sourceUrl: "https://covers.openlibrary.org/wrong", title: "The Hunting of the Last Dragon", authors: [], publisher: "Other" },
  ]);
  assert.deepEqual(ranked, []);
});
