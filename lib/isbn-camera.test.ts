import assert from "node:assert/strict";
import test from "node:test";
import { startIsbnCamera } from "./isbn-camera";

function fixture() {
  let tracksStopped = 0, decoderStopped = 0;
  const stream = { getTracks: () => [{ stop: () => tracksStopped++ }] } as unknown as MediaStream;
  const video = { srcObject: stream } as unknown as HTMLVideoElement;
  const controller = new AbortController();
  return { stream, video, controller, counts: () => ({ tracksStopped, decoderStopped }), controls: { stop: () => decoderStopped++ } };
}

test("camera accepts one checksum-valid ISBN and ignores unrelated or invalid barcodes", async () => {
  const f = fixture(), detected: string[] = [];
  await startIsbnCamera(f.video, isbn => detected.push(isbn), f.controller.signal, {
    getStream: async () => f.stream,
    decode: async (_stream, _video, onCode) => {
      onCode("4006381333931"); onCode("9780306406158"); onCode("garbage9780306406157");
      onCode("9780306406157"); onCode("9780306406157");
      return f.controls;
    },
  });
  assert.deepEqual(detected, ["9780306406157"]);
  assert.ok(f.counts().tracksStopped > 0); assert.ok(f.counts().decoderStopped > 0);
  assert.equal(f.video.srcObject, null);
  f.controller.abort();
});

test("camera stops if permission resolves after cancellation without starting decoder", async () => {
  const f = fixture(); let grant!: (stream: MediaStream) => void;
  const pending = startIsbnCamera(f.video, () => assert.fail("Cancelled scan"), f.controller.signal, {
    getStream: () => new Promise(resolve => { grant = resolve; }),
    decode: async () => { assert.fail("Decoder must not start"); },
  });
  f.controller.abort(); grant(f.stream); await pending;
  assert.ok(f.counts().tracksStopped > 0);
});

test("camera stops both stream and decoder when setup completes after navigation", async () => {
  const f = fixture(); let finish!: () => void;
  const pending = startIsbnCamera(f.video, () => assert.fail("Cancelled scan"), f.controller.signal, {
    getStream: async () => f.stream,
    decode: () => new Promise(resolve => { finish = () => resolve(f.controls); }),
  });
  await Promise.resolve(); f.controller.abort(); finish(); await pending;
  assert.ok(f.counts().tracksStopped > 0); assert.ok(f.counts().decoderStopped > 0);
});

test("decoder errors release the camera and report failure", async () => {
  const f = fixture();
  await assert.rejects(startIsbnCamera(f.video, () => {}, f.controller.signal, {
    getStream: async () => f.stream, decode: async () => { throw new Error("Camera unavailable"); },
  }), /Camera unavailable/);
  assert.ok(f.counts().tracksStopped > 0);
});
