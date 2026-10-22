import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { verifyAssistantToken } from "./assistant-auth";
import { createShelfieMcpServer } from "./shelfie-mcp";
import { SHELFIE_MCP_INSTRUCTIONS } from "./shelfie-mcp-instructions";
import { parseManualGenaiText, MAX_IMPORT_BYTES, SHELFIE_GENAI_PROMPT } from "./manual-genai-import";
import { safeReturnPath } from "./safe-return-path";

const payload = { schemaVersion: "mylibrary.shelfie.v1", books: [{ position: 1, title: "The Hobbit", authors: ["Tolkien"], confidence: .9, visibleIsbn: null, coverUrl: "https://images.example.test/hobbit.jpg" }] };

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
  const coverCalls: unknown[][] = [];
  const server = createShelfieMcpServer({
    updateCovers: async (...args) => { coverCalls.push(args); return { collectionId: id, slug: "books", processed: 1, updated: 1, notFound: 0, failed: 0, skipped: 0, remaining: 0, hasMore: false, nextCursor: null, warning: null, results: [{ id, legacyId: "B1", title: "The Hobbit", status: "updated", coverUrl: "https://images.example.test/hobbit.jpg", message: null }] }; },
    listCollections: async () => [{ id, name: "My books", slug: "books" }],
    listCollectionBooks: async () => ({ collectionId: id, total: 1, offset: 0, limit: 100, hasMore: false, books: [{ id: "B1", title: "The Hobbit", author: "Tolkien", isbn13: null, series: null, volume: null, language: "en" }] }),
    createCollection: async (name, description, books) => { writes++; assert.equal(books.books[0].title, "The Hobbit"); assert.equal(books.books[0].isbn, null); assert.equal(books.books[0].visibleIsbn, null); return { collectionId: id, name, slug: "collection-test", description, importId: id, imported: 1, duplicate: false }; },
    updateCollection: async (_id, books) => { if (books.books[0].visibleIsbn) throw new Error("invalid ISBN"); writes++; assert.equal(books.books[0].title, "The Hobbit"); return { collectionId: id, slug: "books", importId: id, imported: 1, ignoredExisting: 0, duplicate: false }; },
  }, "https://library.test");
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    assert.equal(client.getInstructions(), SHELFIE_MCP_INSTRUCTIONS);
    assert.doesNotMatch(client.getInstructions() ?? "", /IF THE CLIENT CANNOT SEARCH/);
    const listedTools = (await client.listTools()).tools;
    assert.deepEqual(listedTools.map((tool) => tool.name).sort(), ["create_collection", "list_collection_books", "list_collections", "update_collection", "update_covers"]);
    for (const name of ["create_collection", "update_collection"]) {
      const tool = listedTools.find((item) => item.name === name);
      const description = tool?.description ?? "";
      assert.ok(description.startsWith(SHELFIE_MCP_INSTRUCTIONS));
      assert.match(description, /Search for a cover for EACH identified book/);
      assert.match(description, /create the collection ONCE/);
      assert.match(description, /submit JSON directly as tool arguments/);
      assert.doesNotMatch(description, /IF THE CLIENT CANNOT SEARCH|ask the user to enable search|Check the client.s actual capabilities/);
      assert.doesNotMatch(description, /Use a real file-generation tool|PHASE 5|booksSearched === totalBooks/);
      assert.doesNotMatch(JSON.stringify(tool?.inputSchema), /"(?:isbn|visibleIsbn)"/);
      assert.match(JSON.stringify(tool?.inputSchema), /"coverUrl"/);
    }
    const covers = listedTools.find(tool => tool.name === "update_covers")!;
    assert.equal(covers.annotations?.readOnlyHint, false);
    assert.doesNotMatch(JSON.stringify(covers.inputSchema), /"(?:isbn|coverUrl)"/);
    const repaired = await client.callTool({ name: "update_covers", arguments: { collectionId: id } });
    assert.equal(repaired.isError, undefined);
    assert.equal((repaired.structuredContent as { updated: number }).updated, 1);
    assert.equal((repaired.structuredContent as { collectionUrl: string }).collectionUrl, "https://library.test/collections/books");
    assert.deepEqual(coverCalls, [[id, null, 3]]);
    await client.callTool({ name: "update_covers", arguments: { collectionId: id, after: id, limit: 5 } });
    assert.deepEqual(coverCalls[1], [id, id, 5]);
    const invalidBatch = await client.callTool({ name: "update_covers", arguments: { collectionId: id, limit: 6 } });
    assert.equal(invalidBatch.isError, true);
    assert.equal(coverCalls.length, 2);
    const prompts = await client.listPrompts();
    assert.deepEqual(prompts.prompts.map((prompt) => prompt.name), ["read_shelf_photo"]);
    const shelfiePrompt = await client.getPrompt({ name: "read_shelf_photo" });
    const promptText = shelfiePrompt.messages[0]?.content.type === "text" ? shelfiePrompt.messages[0].content.text : "";
    assert.ok(promptText.startsWith(SHELFIE_MCP_INSTRUCTIONS));
    assert.doesNotMatch(promptText, /IF THE CLIENT CANNOT SEARCH|ask the user to enable search/);
    assert.match(promptText, /Call create_collection/);
    assert.match(promptText, /at most 100 books/);
    assert.doesNotMatch(promptText, /Use a real file-generation tool|PHASE 5/);
    assert.match(SHELFIE_GENAI_PROMPT, /Use a real file-generation tool/);
    assert.match(SHELFIE_GENAI_PROMPT, /booksSearched === totalBooks/);
    assert.doesNotMatch(promptText, /ISBN|visibleIsbn|"isbn"/);
    const listed = await client.callTool({ name: "list_collection_books", arguments: { collectionId: id } });
    assert.equal((listed.structuredContent as { total: number }).total, 1);
    const created = await client.callTool({ name: "create_collection", arguments: { name: "RPG", description: "Games", ...payload, books: [{ ...payload.books[0], isbn: "9780261102217", visibleIsbn: "9780261102217" }] } });
    assert.equal((created.structuredContent as { name: string }).name, "RPG");
    const good = await client.callTool({ name: "update_collection", arguments: { collectionId: id, ...payload } });
    assert.equal(good.isError, undefined);
    assert.equal((good.structuredContent as { collectionUrl: string }).collectionUrl, "https://library.test/collections/books");
    const bad = await client.callTool({ name: "update_collection", arguments: { collectionId: id, ...payload, books: [{ ...payload.books[0], coverUrl: "http://invalid.test/cover.jpg" }] } });
    assert.equal(bad.isError, true); assert.equal(writes, 2);
    for (const name of ["create_collection", "update_collection"]) {
      const destination = name === "create_collection" ? { name: "RPG" } : { collectionId: id };
      const unexplained = await client.callTool({ name, arguments: { ...destination, ...payload, books: [{ ...payload.books[0], coverUrl: null }] } });
      assert.equal(unexplained.isError, true);
      assert.match(JSON.stringify(unexplained.content), /Import not performed.*Search for cover URLs/);
      assert.equal(writes, 2, "no write callback runs for unexplained missing covers");
      const { coverUrl: _cover, ...withoutCover } = payload.books[0];
      const omitted = await client.callTool({ name, arguments: { ...destination, ...payload, books: [withoutCover] } });
      assert.equal(omitted.isError, true, "coverUrl must be explicitly supplied");
      assert.equal(writes, 2);
    }
    const searched = await client.callTool({ name: "update_collection", arguments: { collectionId: id, ...payload, books: [{ ...payload.books[0], coverUrl: null, notes: "Searched title/author in publisher catalogue and Open Library; matching book pages had no cover image." }] } });
    assert.equal(searched.isError, undefined, "documented unsuccessful searches remain importable");
    assert.equal(writes, 3);

  } finally { await client.close(); await server.close(); }
});
