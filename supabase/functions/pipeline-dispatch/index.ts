Deno.serve(async () => {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = Deno.env.get("MYLIBRARY_SITE_URL") ?? "https://mylibrary-leste-gr.vercel.app";
  if (!serviceRoleKey) return new Response("Missing service role configuration.", { status: 500 });
  const task = fetch(`${siteUrl}/api/pipeline/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
    body: "{}",
  }).then(async (response) => {
    const result = await response.text();
    if (!response.ok) console.error("Ingestion worker failed", response.status, result);
    else console.log("Ingestion worker completed", result);
  }).catch((error) => console.error("Ingestion dispatch failed", error));
  // Acknowledge pg_net immediately; the database HTTP timeout must not cancel work.
  EdgeRuntime.waitUntil(task);
  return Response.json({ accepted: true }, { status: 202 });
});

