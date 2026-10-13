import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SHELFIE_EXTRACTION_PROTOCOL, SHELFIE_GENAI_PROMPT, MAX_IMPORT_BYTES, parseManualGenaiImport, type ManualGenaiImport } from "./manual-genai-import";

export type ShelfieTools = {
  listCollections: () => Promise<{ id: string; name: string; slug: string }[]>;
  listCollectionBooks: (collectionId: string, limit: number, offset: number) => Promise<{ collectionId: string; total: number; offset: number; limit: number; hasMore: boolean; books: { id: string; title: string; author: string; isbn13: string | null; series: string | null; volume: string | null; language: string }[] }>;
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
  confidence: z.number().min(0).max(1).describe("Confidence that the spine is correctly separated and the title identifies the book."),
  subtitle: optionalText(300), publisher: optionalText(200), language: optionalText(40),
  publicationYear: z.number().int().min(1400).max(2100).nullable().optional(),
  editionStatement: optionalText(160), series: optionalText(200), volume: optionalText(80),
  visibleIsbn: optionalText(32).describe("Complete visibly readable checksum-valid ISBN only; never inferred or looked up."),
  notes: optionalText(500).describe("Concise ambiguity, alternative readings, logo evidence, or correction beyond literal transcription."),
  rawVisibleText: optionalText(1000).describe("All meaningful literal spine text before normalization or bibliographic correction."),
  fieldConfidence: z.object({ title: optionalConfidence, authors: optionalConfidence, publisher: optionalConfidence, series: optionalConfidence, volume: optionalConfidence }).nullable().optional(),
});
const shelfieWriteProtocol = `When the source is one or more shelf photographs, you MUST apply the complete protocol below before constructing this tool call. Do not rely on a separate MCP prompt.\n\n${SHELFIE_EXTRACTION_PROTOCOL}`;

export function createShelfieMcpServer(tools: ShelfieTools, origin: string) {
  const server = new McpServer({ name: "mylibrary-shelfie", version: "1.1.0" }, {
    instructions: "You can list the owner's collections and books and import attached shelf photos. For a shelf photo, internally perform four passes before calling a write tool: (1) count and separate physical spines across all photos; (2) transcribe literal text, including rotated text and logos; (3) resolve structured title, people, publisher, series, and volume only from supported evidence while preserving literal text in rawVisibleText; (4) reconcile the count, positions, and duplicates. Preserve one item per physical book in top-to-bottom, left-to-right order. Keep real duplicate copies separate and do not double-count overlapping photos. Never translate titles or invent bibliographic facts. visibleIsbn is allowed only when every digit is visibly readable and checksum-valid; never look one up. Use calibrated per-field confidence and record plausible alternatives in notes. Omit spines without a meaningful title fragment. The complete protocol is available as the read_shelf_photo prompt. Use create_collection for a requested new collection and update_collection for an existing collection. Never call a write tool without the user's explicit request.",
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
    title: "Create and populate a library collection", description: `Create a collection and atomically import the supplied book JSON. Submit the complete mylibrary.shelfie.v1 payload. Repeating the exact same name and payload returns the original import.\n\n${shelfieWriteProtocol}`,
    inputSchema: { name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).nullable().optional(), schemaVersion: z.literal("mylibrary.shelfie.v1"), books: z.array(bookSchema).min(1).max(100) },
    outputSchema: { collectionId: z.string(), slug: z.string(), importId: z.string(), imported: z.number(), duplicate: z.boolean(), name: z.string().optional(), description: z.string().nullable().optional(), collectionUrl: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ name, description, ...input }) => {
    try {
      const result = await tools.createCollection(name, description ?? null, parseManualGenaiImport(input));
      const output = { ...result, collectionUrl: `${origin}/collections/${result.slug}` };
      return { structuredContent: output, content: [{ type: "text", text: JSON.stringify(output) }] };
    }
    catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Collection could not be created." }] }; }
  });
  server.registerTool("update_collection", {
    title: "Add books to an existing collection",
    description: `Add only new books from the complete mylibrary.shelfie.v1 JSON to an owned collection. The backend ignores books already present using ISBN when available, otherwise normalized title, authors, and volume. Existing books are retained and duplicates within the JSON are also ignored.\n\n${shelfieWriteProtocol}`,
    inputSchema: { collectionId: z.string().uuid(), schemaVersion: z.literal("mylibrary.shelfie.v1"), books: z.array(bookSchema).min(1).max(100) },
    outputSchema: { collectionId: z.string(), slug: z.string(), importId: z.string().nullable(), imported: z.number(), ignoredExisting: z.number(), duplicate: z.boolean(), collectionUrl: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { securitySchemes },
  }, async ({ collectionId, ...input }) => {
    try {
      if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_IMPORT_BYTES) throw new Error("Payload exceeds 1 MB.");
      const result = await tools.updateCollection(collectionId, parseManualGenaiImport(input));
      const output = { ...result, collectionUrl: `${origin}/collections/${result.slug}` };
      return { structuredContent: output, content: [{ type: "text", text: JSON.stringify(output) }] };
    } catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Collection could not be updated." }] }; }
  });
  server.registerPrompt("read_shelf_photo", { title: "Import a shelf photo into myLibrary", description: "Apply the complete four-pass shelf extraction protocol and prepare a reviewed myLibrary import." }, () => ({ messages: [{ role: "user", content: { type: "text", text: SHELFIE_GENAI_PROMPT.replace("Return ONLY valid JSON. Do not use Markdown fences and do not add commentary.", "Apply all rules below to the attached shelf photos and build the complete tool input for create_collection or update_collection. If the destination is not already clear, ask whether to create a named collection or append to an existing one. Show a concise count and uncertainty summary, then obtain explicit confirmation before calling a write tool.") } }] }));
  return server;
}
