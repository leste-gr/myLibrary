import { parseBookLoanChange } from "@/lib/book-loan";
import { changeBookLoan } from "@/lib/book-loan-server";

export async function POST(request: Request) {
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    sameOrigin = ["http:","https:"].includes(origin.protocol) && origin.host === request.headers.get("host");
  } catch { /* Opaque or missing origins cannot make writes. */ }
  const failure = "Could not save loan details. Please try again.";
  if (!sameOrigin || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: failure },{ status: 403 });
  }
  let input;
  try { input = parseBookLoanChange(await request.json()); } catch { /* Malformed JSON. */ }
  if (!input) return Response.json({ error: failure },{ status: 400 });
  const result = await changeBookLoan(input);
  return Response.json(result,{ status: result.error ? 400 : 200,headers: { "Cache-Control": "no-store" } });
}
