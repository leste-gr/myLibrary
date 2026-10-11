import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SHELFIE_GENAI_PROMPT, MAX_IMPORT_BYTES, type ManualGenaiImport } from "./manual-genai-import";

export type ShelfieTools = {
  listCollections: () => Promise<{ id: string; name: string; slug: string }[]>;
  listCollectionBooks: (collectionId: string, limit: number, offset: number) => Promise<{ collectionId: string; total: number; offset: number; limit: number; hasMore: boolean; books: { id: string; title: string; author: string; isbn13: string | null; series: string | null; volume: string | null; language: string }[] }>;
  createCollection: (name: string, description: string | null, payload: ManualGenaiImport) => Promise<ImportResult>;
  updateCollection: (collectionId: string, payload: ManualGenaiImport) => Promise<ImportResult>;
};
type ImportResult = { collectionId: string; slug: string; importId: string | null; imported: number; ignoredExisting?: number; duplicate: boolean; name?: string; description?: string | null };
const optionalText = (max: number) => z.string().max(max).nullable().optional();
const bookSchema = z.object({
  position: z.number().int().min(1).max(100), title: z.string().min(1).max(300),
  authors: z.array(z.string().min(1).max(160)).max(10), confidence: z.number().min(0).max(1),
  subtitle: optionalText(300), publisher: optionalText(200), language: optionalText(40),
  publicationYear: z.number().int().min(1400).max(2100).nullable().optional(),
  editionStatement: optionalText(160), series: optionalText(200), volume: optionalText(80),
  visibleIsbn: optionalText(32), notes: optionalText(500),
});

export function createShelfieMcpServer(tools: ShelfieTools, origin: string) {
  const server = new McpServer({ name: "mylibrary-shelfie", version: "1.0.0" }, {
    instructions: "You can list the owner's collections and books. Create the mylibrary.shelfie.v1 JSON from a shelf photo or other user-provided book information, preserving one record per physical book, order, and duplicate copies. Never invent ISBNs or bibliographic facts. Ask for a clearer photo when needed. Use create_collection with the complete JSON when the user requests a new collection. Use update_collection with the complete JSON and an existing collection id to append books. Never call a write tool without the user's explicit request.",
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
    outputSchema: { collectionId: z.string(), total: z.number(), offset: z.number(), limit: z.number(), hasMore: z.boolean(), books: z.array(z.object({ id: z.string(), title: z.string(), author: z.string(), isbn13: z.string().nullable(), series: z.string().nullable(), volume: z.string().nullable(), language: z.string() })) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ collectionId, limit, offset }) => {
    try { const result = await tools.listCollectionBooks(collectionId, limit, offset); return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] }; }
    catch { return { isError: true, content: [{ type: "text", text: "Unable to list this collection. Check access and try again." }] }; }
  });
  server.registerTool("create_collection", {
    title: "Create and populate a library collection", description: "Create a collection and atomically import the supplied book JSON. The chat model must construct the complete mylibrary.shelfie.v1 payload before calling. Repeating the exact same name and payload returns the original import.",
    inputSchema: { name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullable().optional(), schemaVersion: z.literal("mylibrary.shelfie.v1"), books: z.array(bookSchema).min(1).max(100) },
    outputSchema: { collectionId: z.string(), slug: z.string(), importId: z.string(), imported: z.number(), duplicate: z.boolean(), name: z.string().optional(), description: z.string().nullable().optional(), collectionUrl: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ name, description, ...input }) => {
    try {
      const result = await tools.createCollection(name, description ?? null, input as ManualGenaiImport);
      const output = { ...result, collectionUrl: `${origin}/collections/${result.slug}` };
      return { structuredContent: output, content: [{ type: "text", text: JSON.stringify(output) }] };
    }
    catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Collection could not be created." }] }; }
  });
  server.registerTool("update_collection", {
    title: "Add books to an existing collection",
    description: "Add only new books from the complete mylibrary.shelfie.v1 JSON to an owned collection. The backend ignores books already present using ISBN when available, otherwise normalized title, authors, and volume. Existing books are retained and duplicates within the JSON are also ignored.",
    inputSchema: { collectionId: z.string().uuid(), schemaVersion: z.literal("mylibrary.shelfie.v1"), books: z.array(bookSchema).min(1).max(100) },
    outputSchema: { collectionId: z.string(), slug: z.string(), importId: z.string().nullable(), imported: z.number(), ignoredExisting: z.number(), duplicate: z.boolean(), collectionUrl: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ collectionId, ...input }) => {
    try {
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_IMPORT_BYTES) throw new Error("Payload exceeds 1 MB.");
      const result = await tools.updateCollection(collectionId, input as ManualGenaiImport);
      const output = { ...result, collectionUrl: `${origin}/collections/${result.slug}` };
      return { structuredContent: output, content: [{ type: "text", text: JSON.stringify(output) }] };
    } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Collection could not be updated." }] }; }
  });
  server.registerPrompt("read_shelf_photo", { title: "Read a shelf photo", description: "Extract books using your AI subscription and add them to myLibrary." }, () => ({ messages: [{ role: "user", content: { type: "text", text: SHELFIE_GENAI_PROMPT.replace("Return ONLY valid JSON. Do not use Markdown fences and do not add commentary.", "Use these extraction rules to build the JSON input for create_collection or update_collection. Ask whether to create a new collection or append to an existing one before writing.") } }] }));
  return server;
}
