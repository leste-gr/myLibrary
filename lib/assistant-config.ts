export function assistantConfigured() {
  return process.env.MYLIBRARY_MCP_ENABLED === "true" && Boolean(process.env.MYLIBRARY_SITE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function assistantConfig() {
  if (!assistantConfigured()) throw new Error("Assistant connection is not configured.");
  const origin = new URL(process.env.MYLIBRARY_SITE_URL!).origin;
  if (!origin.startsWith("https://")) throw new Error("The assistant requires an HTTPS site URL.");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return { origin, resource: `${origin}/api/mcp`, issuer: `${supabaseUrl}/auth/v1`, supabaseUrl };
}
