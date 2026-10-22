import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { findVerifiedCover, suitableCoverCandidate } from "./online-cover-search";
import { findMetadataCoverCandidates, type MetadataCoverCandidate, type MetadataCoverInput } from "./metadata-cover-resolver";

const input: MetadataCoverInput = { copyId: "1", title: "The Example Book", authors: ["Alice Writer"], publisher: null, language: "en" };
const candidate: MetadataCoverCandidate = { provider: "openlibrary", providerId: "1", sourceUrl: "https://covers.example.test/cover.png", title: input.title, authors: input.authors, publisher: null, score: 900, evidence: ["matching title and author"] };
const signal = () => AbortSignal.timeout(5000);
const resolveAddresses = async () => ["93.184.216.34"];
const find = async () => [candidate];
const webSearch = async () => [];

test("cover suitability rejects conflicting authors and wrong or unverified volumes", () => {
  assert.equal(suitableCoverCandidate(input,candidate),true);
  assert.equal(suitableCoverCandidate(input,{ ...candidate,authors: ["Zyx Qwerty"] }),false);
  const volume = { ...input,title: "The Example Book Volume II",volume: "2" };
  assert.equal(suitableCoverCandidate(volume,{ ...candidate,title: "The Example Book Vol. 2" }),true);
  assert.equal(suitableCoverCandidate(volume,{ ...candidate,title: "The Example Book Volume 1" }),false);
  assert.equal(suitableCoverCandidate(volume,candidate),false);
});

test("only decoded nonblank cover images are returned with verification evidence", async () => {
  const bytes = await sharp({ create: { width: 120,height: 180,channels: 3,background: "navy" } })
    .composite([{ input: Buffer.from('<svg width="120" height="180"><rect x="15" y="20" width="90" height="80" fill="yellow"/></svg>') }]).png().toBuffer();
  const fetcher: typeof fetch = async () => new Response(new Uint8Array(bytes),{ headers: { "content-type": "image/png" } });
  const found = await findVerifiedCover(input,signal(),{ find,webSearch,fetcher,resolveAddresses });
  assert.equal(found?.coverUrl,candidate.sourceUrl);
  assert.equal(found?.evidence.imageVerified,true); assert.equal(found?.evidence.height,180);
  for (const response of [
    new Response("<html>product page</html>",{ headers: { "content-type": "text/html" } }),
    new Response("invalid PNG",{ headers: { "content-type": "image/png" } }),
    new Response(new Uint8Array(await sharp({ create: { width: 120,height: 180,channels: 3,background: "white" } }).png().toBuffer()),{ headers: { "content-type": "image/png" } }),
    new Response(new Uint8Array(await sharp({ create: { width: 1,height: 1,channels: 3,background: "white" } }).png().toBuffer()),{ headers: { "content-type": "image/png" } }),
  ]) {
    assert.equal(await findVerifiedCover(input,signal(),{ find,webSearch,resolveAddresses,fetcher: async () => response }),null);
  }
});

test("image redirects to private addresses are rejected and dead catalog images allow web fallback", async () => {
  const redirected = await findVerifiedCover(input,signal(),{ find,webSearch,resolveAddresses,
    fetcher: async () => new Response(null,{ status: 302,headers: { location: "https://127.0.0.1/private" } }) });
  assert.equal(redirected,null);
  let fallback = false;
  await findVerifiedCover(input,signal(),{ find,resolveAddresses,fetcher: async () => new Response(null,{ status: 404 }),
    webSearch: async () => { fallback = true; return []; } });
  assert.equal(fallback,true);
  let fetched = false;
  assert.equal(await findVerifiedCover(input,signal(),{ find,webSearch,resolveAddresses: async () => ["10.0.0.1"],
    fetcher: async () => { fetched = true; return new Response(); } }),null);
  assert.equal(fetched,false);
});


test("catalogue providers run independently and an abort prevents further work", async () => {
  const called: string[] = [];
  const controller = new AbortController();
  let started!: () => void;
  const bothStarted = new Promise<void>(resolve => { started = resolve; });
  const fetcher: typeof fetch = async (url, init) => {
    called.push(new URL(String(url)).hostname);
    if (called.length === 2) started();
    await new Promise<void>((_,reject) => init!.signal!.addEventListener("abort",() => reject(new Error("aborted")),{ once: true }));
    return new Response();
  };
  const pending = findMetadataCoverCandidates(input,{ signal: controller.signal,fetcher });
  await bothStarted;
  controller.abort();
  await assert.rejects(pending,/abort/i);
  assert.deepEqual(called.sort(),["openlibrary.org","www.googleapis.com"]);
});
