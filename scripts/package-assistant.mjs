import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const supplied = process.argv[2];
if (!supplied) throw new Error("Usage: node scripts/package-assistant.mjs https://your-deployment.example");
const url = new URL(supplied);
if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Supply a bare HTTPS origin.");
const dir = path.resolve("artifacts/mylibrary-assistant");
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, "plugin.json"), JSON.stringify({
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "mylibrary-shelfie", version: "1.0.0",
  description: "Read shelf photos with your AI subscription and send private book drafts to myLibrary for review.",
  author: { name: "myLibrary" },
  homepage: `${url.origin}/shelfies/connect`,
  repository: "https://github.com/leste-gr/myLibrary",
}, null, 2) + "\n");
await writeFile(path.join(dir, "mcp.json"), JSON.stringify({
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: { mylibrary: { type: "streamable-http", url: `${url.origin}/api/mcp`, extensions: { "com.openai": { auth: { type: "oauth" } } } },
}, null, 2) + "\n");
await writeFile(path.join(dir, "README.md"), `# myLibrary assistant\n\nConnect to ${url.origin}/api/mcp using OAuth (scope: openid).\n\nUpload a shelf photograph in your AI chat and ask to send the books to myLibrary for review. The server supplies extraction instructions and the read_shelf_photo prompt. It exposes only list_collections and create_import_draft. The owner follows the returned review link to edit, exclude, and import books.\n\nRun the setup in docs/CONNECTED_ASSISTANT_SETUP.md before connecting. Packaging does not publish a plugin to the ChatGPT directory; register and test the remote MCP connection in your account, then submit it separately if public distribution is needed.\n`);
console.log(`Assistant package written to ${dir}`);
