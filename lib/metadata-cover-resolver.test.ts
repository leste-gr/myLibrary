import assert from "node:assert/strict";
import test from "node:test";
import { findReviewedCoverCandidates, rankMetadataCovers } from "./metadata-cover-resolver";

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

test("metadata cover ranking accepts an ISBN-less reviewed catalogue cover", () => {
  const ranked = rankMetadataCovers({ copyId: "x", title: "Τα μυστήρια του κόσμου", authors: ["Άρθουρ Κλαρκ"], publisher: null, language: "el" }, [
    { provider: "legacy-library", providerId: "B071", sourceUrl: "/covers/B071.webp", title: "Τα μυστήρια του κόσμου", authors: ["Arthur C. Clarke"], publisher: null },
  ]);
  assert.equal(ranked[0]?.provider, "legacy-library");
});

test("reviewed covers recover a bad title only from one exact useful author", () => {
  const recovered = findReviewedCoverCandidates({ copyId: "G-62F607DF-033", title: "Φερράκ", authors: ["Μάκης Μαλαφέκας"], publisher: null, language: "el" });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].providerId, "B024");
  assert.ok(recovered[0].evidence.includes("representative cover; imported title differs"));
});

test("reviewed covers do not recover a title from an unknown author", () => {
  assert.deepEqual(findReviewedCoverCandidates({ copyId: "x", title: "Wrong", authors: ["Άγνωστος"], publisher: null, language: "el" }), []);
});
