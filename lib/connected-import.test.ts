import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { verifyAssistantToken } from "./assistant-auth";
import { createShelfieMcpServer } from "./shelfie-mcp";
import { parseManualGenaiText, MAX_IMPORT_BYTES } from "./manual-genai-import";
import { safeReturnPath } from "./safe-return-path";

const payload = { schemaVersion: "mylibrary.shelfie.v1", books: [{ position: 1, title: "The Hobbit", authors: ["Tolkien"], confidence: .9, visibleIsbn: null }] };

test("paste accepts JSON fences and BOM without silently repairing invalid output", () => {
  const json = JSON.stringify(payload);
  assert.equal(parseManualGenaiText(`\uFEFF\n\x60\x60\x60json\n${json}\n\x60\x60\x60`).books[0].title, "The Hobbit");
  assert.throws(() => parseManualGenaiText(`Here are your books: ${json}`));
  assert.throws(() => parseManualGenaiText('{"books": ['));
  assert.throws(() => parseManualGenaiText("α".repeat(MAX_IMPORT_BYTES / 2 + 1)), /1 MB/);
  assert.throws(() => parseManualGenaiText(JSON.stringify({ ...payload, books: [payload.books[0], payload.books[0]] })), /duplicated/);
});

test("login preserves review and consent routes but rejects open redirects", () => {
  assert.equal(safeReturnPath("/oauth/consent?authorization_id=123"), "/oauth/consent?authorization_id=123");
  assert.equal(safeReturnPath("/shelfies/review/11111111-1111-4111-8111-111111111111"), "/shelfies/review/11111111-1111-4111-8111-111111111111");
  for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "/login", "/oauth/consent\n", "/%2f%2fevil.test"]) assert.equal(safeReturnPath(path), null);
});

test("assistant JWT requires correct signature, issuer, audience, expiry and OAuth identity", async () => {
  const pair = await generateKeyPair("ES256");
  const key = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test" }] });
  const issuer = "https://test.supabase.co/auth/v1";
  const resource = "https://library.test/api/mcp";
  const claims = { sub: "11111111-1111-4111-8111-111111111111", role: "authenticated", client_id: "assistant", iss: issuer, aud: ["authenticated", resource], exp: Math.floor(Date.now() / 1000) + 300 };
  const sign = (extra: Record<string, unknown> = {}) => new SignJWT({ ...claims, ...extra }).setProtectedHeader({ alg: "ES256", kid: "test" }).sign(pair.privateKey);
  assert.equal((await verifyAssistantToken(await sign(), key, issuer, resource)).sub, claims.sub);
  for (const invalid of [{ iss: "https://other.test" }, { aud: "authenticated" }, { exp: 1 }, { client_id: undefined }, { role: "service_role" }, { sub: "" }]) await assert.rejects(() => sign(invalid).then((token) => verifyAssistantToken(token, key, issuer, resource)));
  const impostor = await generateKeyPair("ES256");
  const forged = await new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "test" }).sign(impostor.privateKey);
  await assert.rejects(() => verifyAssistantToken(forged, key, issuer, resource));
});

test("MCP exposes draft-only tools and validates book data before calling the database", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let writes = 0;
  const server = createShelfieMcpServer({ listCollections: async () => [{ id, name: "My books", slug: "books" }], createDraft: async (_id, books) => { writes++; assert.equal(books.books[0].title, "The Hobbit"); return { draftId: id, status: "pending", bookCount: 1 }; } }, "https://library.test");
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ["create_import_draft", "list_collections"]);
    const good = await client.callTool({ name: "create_import_draft", arguments: { collectionId: id, ...payload } });
    assert.equal(good.isError, undefined);
    assert.equal((good.structuredContent as { reviewUrl: string }).reviewUrl, `https://library.test/shelfies/review/${id}`);
    const bad = await client.callTool({ name: "create_import_draft", arguments: { collectionId: id, ...payload, books: [{ ...payload.books[0], visibleIsbn: "9780000000000" }] } });
    assert.equal(bad.isError, true); assert.equal(writes, 1);
  } finally { await client.close(); await server.close(); }
});
