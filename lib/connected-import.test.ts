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

test("MCP exposes collection browsing and reviewed import tools", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  let writes = 0;
  const server = createShelfieMcpServer({
    listCollections: async () => [{ id, name: "My books", slug: "books" }],
    listCollectionBooks: async () => ({ collectionId: id, total: 1, offset: 0, limit: 100, hasMore: false, books: [{ id: "B1", title: "The Hobbit", author: "Tolkien", isbn13: null, series: null, volume: null, language: "en" }] }),
    createCollection: async (name, description, books) => { writes++; assert.equal(books.books[0].title, "The Hobbit"); return { collectionId: id, name, slug: "collection-test", description, importId: id, imported: 1, duplicate: false }; },
    updateCollection: async (_id, books) => { if (books.books[0].visibleIsbn) throw new Error("invalid ISBN"); writes++; assert.equal(books.books[0].title, "The Hobbit"); return { collectionId: id, slug: "books", importId: id, imported: 1, ignoredExisting: 0, duplicate: false }; },
  }, "https://library.test");
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    assert.match(client.getInstructions() ?? "", /Different-language edition of the same work/);
    assert.match(client.getInstructions() ?? "", /Never report an import as fully verified/);
    assert.match(client.getInstructions() ?? "", /MUST actively search for a cover image for EVERY book/);
    const listedTools = (await client.listTools()).tools;
    assert.deepEqual(listedTools.map((tool) => tool.name).sort(), ["create_collection", "list_collection_books", "list_collections", "update_collection"]);
    for (const name of ["create_collection", "update_collection"]) {
      const tool = listedTools.find((item) => item.name === name);
      const description = tool?.description ?? "";
      assert.match(description, /MANDATORY CLIENT-SIDE COVER SEARCH/);
      assert.match(description, /MUST actively search for a cover image for EVERY book/);
      assert.match(description, /continue in batches until every book has been searched/);
      assert.match(description, /Record the searches attempted and the specific unresolved issue in notes/);
      assert.match(description, /FINAL COVER CHECK/);
      assert.match(description, /number of cover URLs supplied by the client/);
      assert.match(description, /Do not imply that backend fallback covers have been found or verified unless confirmed/);
      assert.doesNotMatch(description, /Use web search .*when available/);
      assert.match(description, /Different-language edition of the same work/);
      assert.match(description, /Never assign an ISBN from a representative cover/);
      assert.match(description, /do not reduce book-identification confidence solely/);
      assert.match(description, /Never report an import as fully verified/);
      assert.match(description, /PASS 1 — PHYSICAL INVENTORY/);
      assert.match(description, /PASS 4 — WEB VERIFICATION AND COVER/);
      assert.match(description, /PASS 5 — FINAL CHECK/);
      assert.match(description, /coverUrl is a direct, public HTTPS URL/);
      assert.match(JSON.stringify(tool?.inputSchema), /"isbn"/);
      assert.match(JSON.stringify(tool?.inputSchema), /"coverUrl"/);
    }
    const prompts = await client.listPrompts();
    assert.deepEqual(prompts.prompts.map((prompt) => prompt.name), ["read_shelf_photo"]);
    const shelfiePrompt = await client.getPrompt({ name: "read_shelf_photo" });
    const promptText = shelfiePrompt.messages[0]?.content.type === "text" ? shelfiePrompt.messages[0].content.text : "";
    assert.match(promptText, /MANDATORY CLIENT-SIDE COVER SEARCH/);
    assert.match(promptText, /FINAL COVER CHECK/);
    assert.match(promptText, /If search tools are unavailable, disclose the blocker before importing/);
    assert.match(promptText, /Different-language edition of the same work/);
    assert.match(promptText, /Never assign an ISBN from a representative cover/);
    assert.match(promptText, /Never report an import as fully verified/);
    assert.doesNotMatch(promptText, /representative cover in the same language is allowed only/);
    assert.match(promptText, /PASS 1 — PHYSICAL INVENTORY/);
    assert.match(promptText, /PASS 4 — WEB VERIFICATION AND COVER/);
    assert.match(promptText, /coverUrl is a direct, public HTTPS URL/);
    const listed = await client.callTool({ name: "list_collection_books", arguments: { collectionId: id } });
    assert.equal((listed.structuredContent as { total: number }).total, 1);
    const created = await client.callTool({ name: "create_collection", arguments: { name: "RPG", description: "Games", ...payload } });
    assert.equal((created.structuredContent as { name: string }).name, "RPG");
    const good = await client.callTool({ name: "update_collection", arguments: { collectionId: id, ...payload } });
    assert.equal(good.isError, undefined);
    assert.equal((good.structuredContent as { collectionUrl: string }).collectionUrl, "https://library.test/collections/books");
    const bad = await client.callTool({ name: "update_collection", arguments: { collectionId: id, ...payload, books: [{ ...payload.books[0], visibleIsbn: "9780000000000" }] } });
    assert.equal(bad.isError, true); assert.equal(writes, 2);
  } finally { await client.close(); await server.close(); }
});
