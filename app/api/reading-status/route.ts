import { changeBooksReadingStatus, changeReadingStatus } from "@/lib/reading-status-server";

export async function POST(request: Request) {
  // Preserve the same-origin protection previously supplied by Server Actions.
  // JSON-only requests also prevent cross-origin HTML forms from making writes.
  // Next may normalize request.url to an internal hostname; compare the browser
  // Origin to the actual Host header, as Server Actions do.
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    sameOrigin = (origin.protocol === "https:" || origin.protocol === "http:")
      && origin.host === request.headers.get("host");
  } catch { /* Missing and opaque origins cannot write. */ }
  if (!sameOrigin
    || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: "Could not save reading status. Please try again." }, { status: 403 });
  }
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Could not save reading status. Please try again." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Could not save reading status. Please try again." }, { status: 400 });
  }
  const result = "legacyIds" in body
    ? await changeBooksReadingStatus(body.slug, body.legacyIds, body.status)
    : await changeReadingStatus(body.slug, body.legacyId, body.status);
  // revalidatePath in a Route Handler expires cached data on the next visit;
  // it doesn't attach the entire collection/radar render to this response.
  return Response.json(result, { status: result.error ? 400 : 200, headers: { "Cache-Control": "no-store" } });
}
