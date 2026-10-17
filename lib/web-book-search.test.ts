import assert from "node:assert/strict";
import test from "node:test";
import { findVerifiedBookPages, parseBingRssLinks, parseDuckDuckGoLinks } from "./web-book-search";
import { assertPublicHttpsUrl, isPublicAddress } from "./safe-remote-fetch";

test("parses and deduplicates HTTPS book pages from Bing RSS", () => {
  const xml = `<rss><channel><item><title>A</title><link>https://books.test/a?x=1&amp;y=2</link></item><item><link>https://books.test/a?x=1&amp;y=2</link></item><item><link>http://unsafe.test/b</link></item></channel></rss>`;
  assert.deepEqual(parseBingRssLinks(xml), ["https://books.test/a?x=1&y=2"]);
});

test("parses direct and redirected DuckDuckGo result pages", () => {
  const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbooks.test%2Fgreek%3Fx%3D1%26y%3D2">A</a><a class="result__a" href="https://publisher.test/book">B</a>`;
  assert.deepEqual(parseDuckDuckGoLinks(html), ["https://books.test/greek?x=1&y=2", "https://publisher.test/book"]);
});

test("rejects loopback and private remote targets", async () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("192.168.1.2"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  await assert.rejects(() => assertPublicHttpsUrl("https://internal.test/a", async () => ["10.0.0.5"]));
  await assert.doesNotReject(() => assertPublicHttpsUrl("https://books.test/a", async () => ["8.8.8.8"]));
});

test("a web search outage is not a confirmed cover miss", async () => {
  for (const status of [403, 429, 503]) {
    await assert.rejects(() => findVerifiedBookPages({ title: "Example book", authors: ["Author"], publisher: null, series: null, volume: null }, async () => new Response("unavailable", { status })), /provider failure/);
  }
});
