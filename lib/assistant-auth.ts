import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { assistantConfig } from "./assistant-config";

let remoteKeys: ReturnType<typeof createRemoteJWKSet> | undefined;
export async function verifyAssistantToken(token: string, key: JWTVerifyGetKey, issuer: string, resource: string) {
  const { payload } = await jwtVerify(token, key, { issuer, audience: resource, algorithms: ["ES256", "RS256"], requiredClaims: ["exp", "sub", "client_id"] });
  if (typeof payload.sub !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.sub) || typeof payload.client_id !== "string" || !payload.client_id || payload.role !== "authenticated") throw new Error("Invalid assistant identity.");
  return payload;
}

export async function authenticateAssistant(request: Request) {
  const { issuer, resource, supabaseUrl } = assistantConfig();
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer \S+$/i.test(authorization)) throw new Error("Bearer token required.");
  const token = authorization.slice(7);
  remoteKeys ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const claims = await verifyAssistantToken(token, remoteKeys, issuer, resource);
  const supabase = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || data.user?.id !== claims.sub) throw new Error("Session expired.");
  const allowed = await supabase.rpc("assistant_connection_allowed");
  if (allowed.error || allowed.data !== true) throw new Error("Connection not authorized.");
  return { supabase, userId: claims.sub };
}
