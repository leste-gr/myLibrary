import { assistantConfigured, assistantConfig } from "@/lib/assistant-config";
export const dynamic = "force-dynamic";
export function GET() {
  if (!assistantConfigured()) return Response.json({ error: "Assistant connection is not enabled." }, { status: 503 });
  const { resource, issuer, origin } = assistantConfig();
  return Response.json({ resource, authorization_servers: [issuer], scopes_supported: ["openid"], bearer_methods_supported: ["header"], resource_documentation: `${origin}/shelfies/connect` }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
