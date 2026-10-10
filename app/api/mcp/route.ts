import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateAssistant } from "@/lib/assistant-auth";
import { assistantConfigured, assistantConfig } from "@/lib/assistant-config";
import { createShelfieMcpServer } from "@/lib/shelfie-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!assistantConfigured()) return Response.json({ error: "Assistant connection is not enabled. Use the paste-and-review import." }, { status: 503 });
  const { origin } = assistantConfig();
  const callerOrigin = request.headers.get("origin");
  if (callerOrigin && callerOrigin !== origin && callerOrigin !== "https://chatgpt.com") return Response.json({ error: "Origin not allowed." }, { status: 403 });
  let auth: Awaited<ReturnType<typeof authenticateAssistant>>;
  try { auth = await authenticateAssistant(request); }
  catch { return Response.json({ error: "Connect your myLibrary account to continue." }, { status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="openid"` } }); }
  const server = createShelfieMcpServer({
    async listCollections() {
      const { data, error } = await auth.supabase.from("collections").select("id,name,slug").eq("owner_id", auth.userId).order("created_at");
      if (error) throw error; return data ?? [];
    },
    async createDraft(collectionId, payload) {
      const { data, error } = await auth.supabase.rpc("create_shelfie_draft", { target_collection_id: collectionId, payload });
      if (error) throw new Error(error.message);
      return data;
    },
  }, origin);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 1024 * 1024 });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally { await server.close(); }
}

export function GET() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
export const DELETE = GET;
