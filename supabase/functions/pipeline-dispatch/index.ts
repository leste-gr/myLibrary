Deno.serve(async () => {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = Deno.env.get("MYLIBRARY_SITE_URL") ?? "https://mylibrary-leste-gr.vercel.app";
  if (!serviceRoleKey) return new Response("Missing service role configuration.", { status: 500 });
  const response = await fetch(`${siteUrl}/api/pipeline/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
    body: "{}",
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
  });
});

