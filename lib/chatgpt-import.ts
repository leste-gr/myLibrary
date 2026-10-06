import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { canonicalIsbn } from "@/lib/isbn";
import { supabaseConfig } from "@/lib/supabase/config";

export type ChatGptBook = {
  title: string;
  author: string;
  publisher: string | null;
  language: string | null;
  visibleIsbn: string | null;
  confidence: number;
};

export function hashImportCode(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function validateBooks(value: unknown): ChatGptBook[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error("books must contain between 1 and 100 items");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`books[${index}] must be an object`);
    const source = item as Record<string, unknown>;
    const title = cleanText(source.title, 300);
    const author = cleanText(source.author, 300);
    if (!title && !author) throw new Error(`books[${index}] needs a title or author`);
    const rawConfidence = Number(source.confidence);
    return {
      title: title || "Άγνωστος τίτλος",
      author: author || "Άγνωστος συγγραφέας",
      publisher: cleanText(source.publisher, 200) || null,
      language: cleanText(source.language, 50) || null,
      visibleIsbn: canonicalIsbn(cleanText(source.visibleIsbn, 32)),
      confidence: Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0,
    };
  });
}

export async function consumeChatGptImport(importCode: string, rawBooks: unknown) {
  const books = validateBooks(rawBooks);
  const { url, key } = supabaseConfig();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const codeHash = hashImportCode(importCode);
  const { data, error } = await supabase.rpc("consume_chatgpt_import", { target_code_hash: codeHash, detected_books: books });
  if (error) throw new Error(error.message);
  return data as { sessionId: string; collectionId: string; imported: number };
}
