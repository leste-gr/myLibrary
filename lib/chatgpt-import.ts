import "server-only";
import { createHash } from "node:crypto";
import { canonicalIsbn, isbnCoverPath } from "@/lib/isbn";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
  const supabase = createSupabaseAdminClient();
  const codeHash = hashImportCode(importCode);
  const now = new Date().toISOString();
  const { data: session, error: claimError } = await supabase
    .from("chatgpt_import_sessions")
    .update({ status: "processing", processing_error: null })
    .eq("code_hash", codeHash)
    .in("status", ["pending", "failed"])
    .gt("expires_at", now)
    .select("id,collection_id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!session) throw new Error("Import code is invalid, expired, or already used.");

  try {
    const { data: lastCopy } = await supabase.from("copies").select("display_order").eq("collection_id", session.collection_id).order("display_order", { ascending: false }).limit(1).maybeSingle();
    const firstOrder = (lastCopy?.display_order ?? 0) + 1;
    for (const [index, book] of books.entries()) {
      const externalKey = `chatgpt:${session.id}:${index}`;
      const { data: work, error: workError } = await supabase.from("works").upsert({
        external_key: externalKey,
        title: book.title,
        author: book.author,
        normalized_title: book.title.toLocaleLowerCase(),
        normalized_author: book.author.toLocaleLowerCase(),
        updated_at: now,
      }, { onConflict: "external_key" }).select("id").single();
      if (workError || !work) throw new Error(workError?.message || "Could not create work.");

      const legacyId = `C-${session.id.slice(0, 8).toUpperCase()}-${String(index + 1).padStart(3, "0")}`;
      let { data: copy } = await supabase.from("copies").select("id").eq("collection_id", session.collection_id).eq("legacy_id", legacyId).maybeSingle();
      if (!copy) {
        const created = await supabase.from("copies").insert({
          collection_id: session.collection_id,
          legacy_id: legacyId,
          work_id: work.id,
          display_order: firstOrder + index,
          category: "Αταξινόμητα",
          language: book.language || "Άγνωστη",
          publisher: book.publisher,
          published: true,
        }).select("id").single();
        if (created.error || !created.data) throw new Error(created.error?.message || "Could not create copy.");
        copy = created.data;
      }

      const { data: observation } = await supabase.from("book_observations").select("id").eq("chatgpt_import_session_id", session.id).eq("detection_index", index).maybeSingle();
      const observationPayload = {
        collection_id: session.collection_id,
        copy_id: copy.id,
        chatgpt_import_session_id: session.id,
        detection_index: index,
        source_type: "chatgpt_shelfie",
        title_text: book.title,
        author_text: book.author,
        publisher_text: book.publisher,
        isbn_text: book.visibleIsbn,
        language_hint: book.language,
        confidence: book.confidence,
        status: "ready_for_matching",
        raw_payload: { source: "chatgpt-account", detection_index: index },
      };
      const observationResult = observation
        ? await supabase.from("book_observations").update(observationPayload).eq("id", observation.id)
        : await supabase.from("book_observations").insert(observationPayload);
      if (observationResult.error) throw new Error(observationResult.error.message);

      if (book.visibleIsbn) {
        const { error: candidateError } = await supabase.from("edition_candidates").upsert({
          copy_id: copy.id,
          isbn13: book.visibleIsbn,
          title: book.title,
          publishers: book.publisher ? [book.publisher] : [],
          cover_url: isbnCoverPath(book.visibleIsbn),
          provider: "chatgpt-visible-isbn",
          provider_id: `chatgpt:${session.id}:${index}`,
          score: 1200,
          suggested: true,
          rank: 1,
          evidence: ["visible valid ISBN transcribed by ChatGPT"],
          selection_state: "alternative",
          confidence: book.confidence,
          algorithm_version: "chatgpt-import-v1",
          score_breakdown: { visible_isbn: 1200 },
          provider_count: 1,
          last_evaluated_at: now,
        }, { onConflict: "copy_id,isbn13" });
        if (candidateError) throw new Error(candidateError.message);
      }
    }
    const { error: completeError } = await supabase.from("chatgpt_import_sessions").update({ status: "completed", detected_book_count: books.length, consumed_at: now }).eq("id", session.id);
    if (completeError) throw new Error(completeError.message);
    return { sessionId: session.id, collectionId: session.collection_id, imported: books.length };
  } catch (error) {
    await supabase.from("chatgpt_import_sessions").update({ status: "failed", processing_error: error instanceof Error ? error.message.slice(0, 2000) : "Unknown import error" }).eq("id", session.id);
    throw error;
  }
}
