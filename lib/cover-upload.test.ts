import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { prepareCoverUpload, prepareCoverFromUrl } from "./cover-upload";
import { MAX_COVER_UPLOAD_BYTES } from "./book-cover";

test("cover uploads are decoded, resized, stripped of metadata and converted to WebP", async () => {
  const input = await sharp({ create: { width: 1800, height: 2700, channels: 3, background: "#71332f" } })
    .withMetadata().jpeg().toBuffer();
  const output = await prepareCoverUpload(new File([Uint8Array.from(input)], "cover.jpg", { type: "image/jpeg" }));
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 2400);
  assert.equal(metadata.exif, undefined);
});

test("public cover links are copied and decoded through the upload pipeline", async () => {
  const input = await sharp({ create: { width: 30, height: 50, channels: 3, background: "red" } }).png().toBuffer();
  const fetcher = (async () => new Response(input, { headers: { "content-type": "image/png" } })) as typeof fetch;
  const output = await prepareCoverFromUrl("https://example.com/cover.png", fetcher, async () => ["93.184.216.34"]);
  assert.equal((await sharp(output).metadata()).format, "webp");
});

test("cover links reject private hosts, unsafe redirects, non-images and oversized streams", async () => {
  const publicDns = async () => ["93.184.216.34"];
  let called = false;
  const fetcher = (async () => { called = true; return new Response("not image", { headers: { "content-type": "text/html" } }); }) as typeof fetch;
  await assert.rejects(() => prepareCoverFromUrl("https://localhost/cover.png", fetcher, publicDns), /public HTTPS/);
  await assert.rejects(() => prepareCoverFromUrl("http://example.com/a.png", fetcher, publicDns), /public HTTPS/);
  await assert.rejects(() => prepareCoverFromUrl("https://example.com/a.png", fetcher, async () => ["::ffff:127.0.0.1"]), /public HTTPS/);
  assert.equal(called, false);
  await assert.rejects(() => prepareCoverFromUrl("https://example.com/a.png", fetcher, publicDns), /public HTTPS/);
  const redirect = (async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/cover.png" } })) as typeof fetch;
  await assert.rejects(() => prepareCoverFromUrl("https://example.com/a.png", redirect, publicDns), /public HTTPS/);
  const large = (async () => new Response(new Uint8Array(MAX_COVER_UPLOAD_BYTES + 1), { headers: { "content-type": "image/png" } })) as typeof fetch;
  await assert.rejects(() => prepareCoverFromUrl("https://example.com/a.png", large, publicDns), /public HTTPS/);
});

test("cover uploads reject empty, oversized, disguised and corrupt images", async () => {
  await assert.rejects(() => prepareCoverUpload(new File([], "empty.jpg", { type: "image/jpeg" })), /Choose a cover/);
  await assert.rejects(() => prepareCoverUpload(new File([new Uint8Array(MAX_COVER_UPLOAD_BYTES + 1)], "large.jpg", { type: "image/jpeg" })), /4 MB/);
  await assert.rejects(() => prepareCoverUpload(new File(["<svg/>"], "cover.svg", { type: "image/svg+xml" })), /JPG, PNG or WebP/);
  await assert.rejects(() => prepareCoverUpload(new File(["not an image"], "cover.jpg", { type: "image/jpeg" })), /could not be read/);
});
