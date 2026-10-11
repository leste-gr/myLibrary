import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseManualGenaiImport, SHELFIE_GENAI_PROMPT, MAX_IMPORT_BYTES, type ManualGenaiImport } from "./manual-genai-import";

export type ShelfieTools = {
  listCollections: () => Promise<{ id: string; name: string; slug: string }[]>;
  listCollectionBooks: (collectionId: string, limit: number, offset: number) => Promise<{ collectionId: string; total: number; offset: number; limit: number; hasMore: boolean; books: { id: string; title: string; author: string; isbn13: string | null; series: string | null; volume: string | null; language: string }[] }>;
  createCollection: (name: string, description: string | null) => Promise<{ id: string; name: string; slug: string; description: string | null }>;
  createDraft: (collectionId: string, payload: ManualGenaiImport) => Promise<{ draftId: string; status: string; bookCount: number }>;
};
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
    instructions: "You can list the owner's collections and books. Extract one record per physical spine or supplied JSON entry, preserving order and duplicate copies. Never invent ISBNs or bibliographic facts. Ask for a clearer photo when needed. Before importing, list collections and ask whether to use one or create a new collection. Create a collection only when the user explicitly requests it. Submit private drafts only; return the review URL and explain that the owner must review and import in myLibrary. Never claim a draft is published.",
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
    title: "Create a library collection", description: "Create a new empty collection owned by the signed-in user. Call only after the user explicitly asks for a new collection, then use its id with create_import_draft.",
    inputSchema: { name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullable().optional() },
    outputSchema: { id: z.string(), name: z.string(), slug: z.string(), description: z.string().nullable() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ name, description }) => {
    try { const result = await tools.createCollection(name, description ?? null); return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] }; }
    catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Collection could not be created." }] }; }
  });
  server.registerTool("create_import_draft", {
    title: "Send books to myLibrary for review",
    description: "Create a private, owner-only draft from visible book spines after the user requests it. No books are published. Use one record per physical book, retain repeated copies, preserve shelf order, and transcribe only visible information. visibleIsbn must be null unless read in full from the photo. Return the review URL to the user. Repeating the same payload returns the same draft.",
    inputSchema: { collectionId: z.string().uuid(), schemaVersion: z.literal("mylibrary.shelfie.v1"), books: z.array(bookSchema).min(1).max(100) },
    outputSchema: { draftId: z.string(), status: z.string(), bookCount: z.number(), reviewUrl: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ collectionId, ...input }) => {
    try {
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_IMPORT_BYTES) throw new Error("Payload exceeds 1 MB.");
      const payload = parseManualGenaiImport(input);
      const draft = await tools.createDraft(collectionId, payload);
      const result = { ...draft, reviewUrl: `${origin}/shelfies/review/${draft.draftId}` };
      return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Draft could not be created." }] }; }
  });
  server.registerPrompt("read_shelf_photo", { title: "Read a shelf photo", description: "Extract books using your AI subscription and send a private draft to myLibrary." }, () => ({ messages: [{ role: "user", content: { type: "text", text: SHELFIE_GENAI_PROMPT.replace("Return ONLY valid JSON. Do not use Markdown fences and do not add commentary.", "Use these extraction rules with list_collections and create_import_draft. Ask for the destination collection. Return the draft review link; do not publish books.") } }] }));
  return server;
}
