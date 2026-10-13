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


test("accepts a translated-title representative cover from a distinctive contributor signature", () => {
  const ranked = rankMetadataCovers(
    { copyId: "G-62F607DF-001", title: "Sapiens: Τα θεμέλια του πολιτισμού", authors: ["Yuval Noah Harari", "Vandermeulen", "Casanave"], publisher: null, language: "el" },
    [{ provider: "openlibrary", providerId: "15252176", sourceUrl: "https://covers.openlibrary.org/b/id/15252176-L.jpg", title: "Sapiens: A Graphic History, Volume 2: The Pillars of Civilization", authors: ["Yuval Noah Harari", "David VanderMeulen", "Daniel Casanave"], publisher: "National Geographic Books" }],
  );
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].evidence.includes("matching contributor signature (3)"));
  assert.equal(ranked[0].isbn13, undefined);
  assert.ok(ranked[0].score > 500 && ranked[0].score <= 850);
  assert.equal(ranked[0].editionConfidence, 0.3);
  assert.equal(ranked[0].coverConfidence, 0.72);
});

test("does not reuse a series cover when only the contributors and series title match", () => {
  const ranked = rankMetadataCovers(
    { copyId: "G-62F607DF-003", title: "Sapiens: Η γέννηση του ανθρώπου", authors: ["Yuval Noah Harari", "Vandermeulen", "Casanave"], publisher: null, language: "el" },
    [{ provider: "openlibrary", providerId: "15252176", sourceUrl: "https://covers.openlibrary.org/b/id/15252176-L.jpg", title: "Sapiens: A Graphic History, Volume 2: The Pillars of Civilization", authors: ["Yuval Noah Harari", "David VanderMeulen", "Daniel Casanave"], publisher: "National Geographic Books" }],
  );
  assert.deepEqual(ranked, []);
});
