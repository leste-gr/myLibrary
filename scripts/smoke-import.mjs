import assert from "node:assert/strict";
const origin = new URL(process.argv[2] || "http://127.0.0.1:3000").origin;
for (const route of ["/shelfies/try", "/shelfies/connect", "/oauth/consent"]) {
  const response = await fetch(origin + route, { redirect: "manual" });
  assert.equal(response.status, 200, route);
  const html = await response.text();
  if (route === "/shelfies/try") assert.ok(html.includes('id="ai-response"'), "Paste review input must render");
  console.log(`PASS ${route}: ${response.status}`);
}
const metadata = await fetch(origin + "/.well-known/oauth-protected-resource");
assert.ok([200, 503].includes(metadata.status), "Discovery is available or explicitly disabled");
const mcp = await fetch(origin + "/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
assert.ok([401, 503].includes(mcp.status), "Anonymous requests must not reach private tools");
if (metadata.status === 200) {
  assert.equal(mcp.status, 401);
  assert.ok(mcp.headers.get("www-authenticate")?.includes("resource_metadata="));
} else { assert.equal(mcp.status, 503); }
console.log(`PASS MCP authentication/availability: ${mcp.status}; discovery: ${metadata.status}`);
