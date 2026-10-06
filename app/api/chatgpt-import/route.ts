import { NextResponse } from "next/server";
import { consumeChatGptImport } from "@/lib/chatgpt-import";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const importCode = typeof body?.importCode === "string" ? body.importCode : "";
    if (!importCode || !Array.isArray(body?.books)) {
      return NextResponse.json({ error: "importCode and books are required." }, { status: 400 });
    }
    const result = await consumeChatGptImport(importCode, body.books);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    const status = /invalid, expired, or already used/i.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
