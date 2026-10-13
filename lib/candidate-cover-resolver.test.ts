import assert from "node:assert/strict";
import test from "node:test";
import { probeCandidateCover, representativeCoverConfidence } from "./candidate-cover-resolver";

test("representative cover confidence combines work evidence with a verified image", () => {
  assert.equal(representativeCoverConfidence(0.9), 0.91);
  assert.equal(representativeCoverConfidence(1), 1);
});

test("accepts a verified provider image", async () => {
  const source = await probeCandidateCover("https://library.test", "9789602489987", async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "X-Cover-Source": "openlibrary" },
  }));
  assert.equal(source, "openlibrary");
});

test("rejects placeholders and unlabelled images", async () => {
  const placeholder = await probeCandidateCover("https://library.test", "9789602489987", async () => new Response("<svg/>", {
    status: 200,
    headers: { "Content-Type": "image/svg+xml", "X-Cover-Source": "placeholder" },
  }));
  const unlabelled = await probeCandidateCover("https://library.test", "9789602489987", async () => new Response(new Uint8Array([1]), {
    status: 200,
    headers: { "Content-Type": "image/jpeg" },
  }));
  assert.equal(placeholder, null);
  assert.equal(unlabelled, null);
});

test("rejects removed legacy cover redirects without following them", async () => {
  let requests = 0;
  const source = await probeCandidateCover("https://library.test", "9789602489987", async () => {
    requests++;
    return new Response(null, { status: 307, headers: {
      Location: "https://library.test/covers/B074.webp", "X-Cover-Source": "legacy-library",
    } });
  });
  assert.equal(source, null);
  assert.equal(requests, 1);
});
