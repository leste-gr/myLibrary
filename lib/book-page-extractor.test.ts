import assert from "node:assert/strict";
import test from "node:test";
import { buildBookPageSearchQueries, extractBookPage, verifyBookPage } from "./book-page-extractor";

const input = { title: "Room", authors: ["Emma Donoghue"], publisher: "Picador", series: null, volume: null };

test("builds progressively broader book-page searches", () => {
  const queries = buildBookPageSearchQueries(input);
  assert.deepEqual(queries, ['"Room" ISBN', '"Room" "Emma Donoghue" "Picador"', '"Room" "Emma Donoghue" εξώφυλλο', 'Room "Emma Donoghue" "Picador"']);
});

test("accepts a plausible title correction only when strongly supported by the author", () => {
  const greek = { title: "Ο μάγος της Δωδεκανήσου", authors: ["Ούρσουλα Λε Γκεν"], publisher: null, series: null, volume: null };
  const verified = verifyBookPage(greek, "https://shop.test/earthsea", { title: "Ο μάγος της Γαιοθάλασσας", authors: ["Ursula Le Guin"], publisher: null, isbn13: "9789605212711", imageUrl: "https://shop.test/earthsea.jpg", structuredType: "Book" });
  assert.equal(verified.accepted, true);
  assert.ok(verified.evidence.includes("plausible title correction"));
});

test("extracts and verifies schema.org Book metadata with its image", () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"Room","author":{"@type":"Person","name":"Emma Donoghue"},"publisher":{"name":"Picador"},"isbn":"9780330519021","image":"https://publisher.test/room.jpg"}</script>`;
  const page = extractBookPage(html);
  const verified = verifyBookPage(input, "https://publisher.test/room", page);
  assert.equal(page.isbn13, "9780330519021");
  assert.equal(verified.accepted, true);
  assert.ok(verified.coverConfidence > 0.9);
});

test("rejects a page with a conflicting author even when the title matches", () => {
  const verified = verifyBookPage(input, "https://shop.test/wrong", { title: "Room", authors: ["Someone Else"], publisher: "Picador", isbn13: null, imageUrl: "https://shop.test/wrong.jpg", structuredType: "Product" });
  assert.equal(verified.accepted, false);
});
