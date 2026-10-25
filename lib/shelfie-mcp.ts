import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CoverUpdateResult } from "./update-covers";
import { SHELFIE_MCP_INSTRUCTIONS } from "./shelfie-mcp-instructions";
import { SHELFIE_GENAI_PROMPT, MAX_IMPORT_BYTES, parseManualGenaiImport, type ManualGenaiImport } from "./manual-genai-import";

export type ShelfieTools = {
  updateCovers: (collectionId: string, after: string | null, limit: number) => Promise<CoverUpdateResult>;
  listCollections: () => Promise<{ id: string; name: string; slug: string }[]>;
  listCollectionBooks: (collectionId: string, limit: number, offset: number) => Promise<{ collectionId: string; total: number; offset: number; limit: number; hasMore: boolean; books: { id: string; title: string; author: string; isbn13: string | null; series: string | null; volume: string | null; language: string; categories: string[] }[] }>;
  createCollection: (name: string, description: string | null, payload: ManualGenaiImport) => Promise<ImportResult>;
  updateCollection: (collectionId: string, payload: ManualGenaiImport) => Promise<ImportResult>;
};
type ImportResult = { collectionId: string; slug: string; importId: string | null; imported: number; ignoredExisting?: number; duplicate: boolean; name?: string; description?: string | null };
const optionalText = (max: number) => z.string().max(max).nullable().optional();
const optionalConfidence = z.number().min(0).max(1).nullable().optional();
const bookSchema = z.object({
  position: z.number().int().min(1).max(100).describe("Consecutive physical shelf order, top-to-bottom then left-to-right."),
  title: z.string().max(300).nullable().optional().describe("Best-supported work or volume title; omit the spine if no meaningful title fragment is readable."),
  authors: z.array(z.string().min(1).max(160)).max(10).describe("Supported person names only; use [] when none can be identified."),
  categories: z.array(z.string().trim().min(1).max(80)).min(1).max(8).describe("Required category tags inferred by the client from supported title, author, series and subject metadata. Use concise English format/genre/subject tags such as Fiction, Fantasy, Science Fiction, Comics & Graphic Novels, Tabletop Roleplaying, Rulebooks, Game Reference, Game Adventures, History, Biography. Never confuse game manuals with novels. Use Uncategorized only if no supported tag is possible."),
  confidence: z.number().min(0).max(1).describe("Confidence that the spine is correctly separated and the title identifies the work; do not reduce it solely because the cover is representative."),
  subtitle: optionalText(300), publisher: optionalText(200), language: optionalText(40),
  publicationYear: z.number().int().min(1400).max(2100).nullable().optional(),
  editionStatement: optionalText(160), series: optionalText(200), volume: optionalText(80),
  coverUrl: z.string().trim().min(1).max(2048).nullable().describe("Direct public HTTPS cover-image URL for the same work and volume. Prefer exact edition, then same-language edition, then different-language edition; null only after a documented unsuccessful search or search/access blocker."),
  notes: optionalText(500).describe("Record representative-cover use and known differences. For null coverUrl, record searches attempted and the specific unresolved issue or search/access blocker; a backend-resolution request alone is insufficient. Include bibliographic uncertainties or corrections."),
  rawVisibleText: optionalText(1000).describe("All meaningful literal spine text before normalization or bibliographic correction."),
  fieldConfidence: z.object({ title: optionalConfidence, authors: optionalConfidence, publisher: optionalConfidence, series: optionalConfidence, volume: optionalConfidence }).nullable().optional(),
});
// Validate the whole batch before calling a write callback; clients must repair
// an incomplete cover submission without leaving a partially created collection.
function reviewedCoverImport(input: unknown): ManualGenaiImport {
  const payload = parseManualGenaiImport(input);
  const unexplained = payload.books.filter(book => !book.coverUrl && !book.notes?.trim());
  if (unexplained.length) {
    throw new Error(`Import not performed. Search for cover URLs before retrying. Missing covers without search explanations: ${unexplained.map(book => `${book.position}: ${book.title}`).join("; ")}. Search each book using web/image tools and submit a direct HTTPS coverUrl. If a search finds no credible cover or is blocked, explicitly submit coverUrl: null and explain the queries/sources tried and the specific outcome in notes. Do not ask the user to request cover searching again.`);
  }
  return payload;
}

export function createShelfieMcpServer(tools: ShelfieTools, origin: string) {
  const server = new McpServer({ name: "mylibrary-shelfie", version: "1.10.0" }, {
    instructions: SHELFIE_MCP_INSTRUCTIONS,
  });
  const securitySchemes = [{ type: "oauth2", scopes: ["openid"] }];
  server.registerTool("list_collections", {
    title: "List my library collections", description: "List the signed-in user's collections as destinations for a shelf photo import. Do not guess a collection ID.",
    inputSchema: {}, outputSchema: { collections: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() })) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, _meta: { securitySchemes },
  }, async () => {
    try { const collections = await tools.listCollections(); return { structuredContent: { collections }, content: [{ type: "text", text: JSON.stringify({ collections }) }] }; }
    catch { return { isError: true, content: [{ type: "text", text: "Unable to list collections. Check your connection and try again." }] }; }
  });
  server.registerTool("list_collection_books", {
    title: "List books in a collection", description: "List the signed-in user's published books in shelf order. Use pagination until hasMore is false when the user asks for the complete collection.",
    inputSchema: { collectionId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(100), offset: z.number().int().min(0).max(100000).default(0) },
    outputSchema: { collectionId: z.string(), total: z.number(), offset: z.number(), limit: z.number(), hasMore: z.boolean(), books: z.array(z.object({ id: z.string(), title: z.string(), author: z.string(), isbn13: z.string().nullable(), series: z.string().nullable(), volume: z.string().nullable(), language: z.string(), categories: z.array(z.string()) })) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ collectionId, limit, offset }) => {
    try { const result = await tools.listCollectionBooks(collectionId, limit, offset); return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] }; }
    catch { return { isError: true, content: [{ type: "text", text: "Unable to list this collection. Check access and try again." }] }; }
  });
  server.registerTool("create_collection", {
    title: "Create and populate a library collection", description: `${SHELFIE_MCP_INSTRUCTIONS}

Create a collection and atomically import the supplied book JSON. Submit the complete mylibrary.shelfie.v1 payload. Repeating the exact same name and payload returns the original import.`,
    inputSchema: { name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullable().optional(), schemaVersion: z.literal("mylibrary.shelfie.v1"), books: z.array(bookSchema).min(1).max(100) },
    outputSchema: { collectionId: z.string(), slug: z.string(), importId: z.string(), imported: z.number(), duplicate: z.boolean(), name: z.string().optional(), description: z.string().nullable().optional(), collectionUrl: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ name, description, ...input }) => {
    try {
      const result = await tools.createCollection(name, description ?? null, reviewedCoverImport(input));
      const output = { ...result, collectionUrl: `${origin}/collections/${result.slug}` };
      return { structuredContent: output, content: [{ type: "text", text: JSON.stringify(output) }] };
    }
    catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Collection could not be created." }] }; }
  });
  server.registerTool("update_collection", {
    title: "Add books to an existing collection",
    description: `${SHELFIE_MCP_INSTRUCTIONS}

Add only new books from the complete mylibrary.shelfie.v1 JSON to an owned collection. The backend ignores books already present using normalized title, authors, and volume. Existing books are retained and duplicates within the JSON are also ignored.`,
    inputSchema: { collectionId: z.string().uuid(), schemaVersion: z.literal("mylibrary.shelfie.v1"), books: z.array(bookSchema).min(1).max(100) },
    outputSchema: { collectionId: z.string(), slug: z.string(), importId: z.string().nullable(), imported: z.number(), ignoredExisting: z.number(), duplicate: z.boolean(), collectionUrl: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ collectionId, ...input }) => {
    try {
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_IMPORT_BYTES) throw new Error("Payload exceeds 1 MB.");
      const result = await tools.updateCollection(collectionId, reviewedCoverImport(input));
      const output = { ...result, collectionUrl: `${origin}/collections/${result.slug}` };
      return { structuredContent: output, content: [{ type: "text", text: JSON.stringify(output) }] };
    } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Collection could not be updated." }] }; }
  });
  server.registerTool("update_covers", {
    title: "Find and save missing book covers",
    description: "Search online on the server for books whose stored cover URL is null in an owned collection, verify suitable direct HTTPS images, and save the URLs. Existing covers and owner uploads are preserved. Use list_collections for the collection ID. Each call processes a small batch to avoid timeouts. Start without after; while hasMore is true, call update_covers again with the exact nextCursor as after until the whole collection has been checked. Continue based on hasMore, not remaining: remaining includes documented misses and failures already checked. Report cumulative updated/notFound/failed counts honestly. Retrying from the start searches still-missing covers again. The tool performs its own online searches; the client does not need to find or submit cover URLs.",
    inputSchema: { collectionId: z.string().uuid(), after: z.string().uuid().nullable().default(null), limit: z.number().int().min(1).max(5).default(3) },
    outputSchema: { collectionId: z.string(), slug: z.string(), collectionUrl: z.string(),
      processed: z.number(), updated: z.number(), notFound: z.number(), failed: z.number(), skipped: z.number(), remaining: z.number(), warning: z.string().nullable(),
      hasMore: z.boolean(), nextCursor: z.string().nullable(), results: z.array(z.object({
        id: z.string(), legacyId: z.string(), title: z.string(), status: z.enum(["updated","not_found","failed","skipped"]),
        coverUrl: z.string().nullable(), message: z.string().nullable(),
      })) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, _meta: { securitySchemes },
  }, async ({ collectionId, after, limit }) => {
    try {
      const result = await tools.updateCovers(collectionId,after,limit);
      const output = { ...result,collectionUrl: `${origin}/collections/${result.slug}` };
      return { structuredContent: output,content: [{ type: "text",text: JSON.stringify(output) }] };
    } catch (error) {
      return { isError: true,content: [{ type: "text",text: error instanceof Error ? error.message : "Missing covers could not be updated." }] };
    }
  });
  server.registerPrompt("read_shelf_photo", {
    title: "Import a shelf photo into myLibrary",
    description: "Inventory shelf photos, search covers and import through the collection tools.",
  }, () => ({ messages: [{ role: "user", content: {
    type: "text",
    text: `${SHELFIE_MCP_INSTRUCTIONS}\n\nUse the following book payload inside the selected import tool, together with its destination arguments:\n${SHELFIE_GENAI_PROMPT.slice(SHELFIE_GENAI_PROMPT.indexOf("Use this exact schema and field names:"))}`,
  } }] }));
  return server;
}
