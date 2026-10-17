import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { prepareCoverUpload } from "./cover-upload";
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

test("cover uploads reject empty, oversized, disguised and corrupt images", async () => {
  await assert.rejects(() => prepareCoverUpload(new File([], "empty.jpg", { type: "image/jpeg" })), /Choose a cover/);
  await assert.rejects(() => prepareCoverUpload(new File([new Uint8Array(MAX_COVER_UPLOAD_BYTES + 1)], "large.jpg", { type: "image/jpeg" })), /4 MB/);
  await assert.rejects(() => prepareCoverUpload(new File(["<svg/>"], "cover.svg", { type: "image/svg+xml" })), /JPG, PNG or WebP/);
  await assert.rejects(() => prepareCoverUpload(new File(["not an image"], "cover.jpg", { type: "image/jpeg" })), /could not be read/);
});
