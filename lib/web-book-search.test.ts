import assert from "node:assert/strict";
import test from "node:test";
import { parseBingRssLinks } from "./web-book-search";
import { assertPublicHttpsUrl, isPublicAddress } from "./safe-remote-fetch";

test("parses and deduplicates HTTPS book pages from Bing RSS", () => {
  const xml = `<rss><channel><item><title>A</title><link>https://books.test/a?x=1&amp;y=2</link></item><item><link>https://books.test/a?x=1&amp;y=2</link></item><item><link>http://unsafe.test/b</link></item></channel></rss>`;
  assert.deepEqual(parseBingRssLinks(xml), ["https://books.test/a?x=1&y=2"]);
});

test("rejects loopback and private remote targets", async () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("192.168.1.2"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  await assert.rejects(() => assertPublicHttpsUrl("https://internal.test/a", async () => ["10.0.0.5"]));
  await assert.doesNotReject(() => assertPublicHttpsUrl("https://books.test/a", async () => ["8.8.8.8"]));
});
