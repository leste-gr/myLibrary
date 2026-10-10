import assert from "node:assert/strict";
import test from "node:test";
import { normalizedText, rankIsbnCandidates, textSimilarity, type ProviderCandidate } from "./isbn-matcher";

test("normalizes Greek accents and punctuation", () => {
  assert.equal(normalizedText("  Τά Τρία-Σώματα! "), "τα τρια σωματα");
  assert.equal(textSimilarity("Το Χόμπιτ", "Το Χομπιτ"), 1);
});

test("ranks metadata agreement above a title-only candidate", () => {
  const records: ProviderCandidate[] = [
    {
      isbn13: "9780000000002",
      title: "Dune",
      authors: ["Someone Else"],
      publishers: ["Other"],
      publishedDate: "2000",
      language: "en",
      provider: "openlibrary",
      providerId: "OL1W",
    },
    {
      isbn13: "9780441172719",
      title: "Dune",
      authors: ["Frank Herbert"],
      publishers: ["Ace"],
      publishedDate: "1990",
      language: "en",
      provider: "openlibrary",
      providerId: "OL2W",
    },
    {
      isbn13: "9780441172719",
      title: "Dune",
      authors: ["Frank Herbert"],
      publishers: ["Ace"],
      publishedDate: "1990-09-01",
      language: "en",
      provider: "google-books",
      providerId: "google-2",
    },
  ];
  const ranked = rankIsbnCandidates({ title: "Dune", authors: ["Frank Herbert"], publisher: "Ace", publicationYear: 1990, language: "en", series: null }, records);
  assert.equal(ranked[0].isbn13, "9780441172719");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].providerCount, 2);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[0].evidence.includes("multiple providers agree on ISBN"));
});

test("deduplicates ISBNs and applies the requested limit", () => {
  const records: ProviderCandidate[] = ["9780441172719", "9780261102217", "9780140328721"].flatMap((isbn13, index) => [
    { isbn13, title: `Book ${index}`, authors: [], publishers: [], publishedDate: null, language: null, provider: "openlibrary" as const, providerId: `OL${index}` },
    { isbn13, title: `Book ${index}`, authors: [], publishers: [], publishedDate: null, language: null, provider: "google-books" as const, providerId: `G${index}` },
  ]);
  const ranked = rankIsbnCandidates({ title: "Book 0", authors: [], publisher: null, publicationYear: null, language: null, series: null }, records, 2);
  assert.equal(ranked.length, 2);
  assert.equal(new Set(ranked.map((item) => item.isbn13)).size, 2);
});
