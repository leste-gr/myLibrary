"use client";
import { useTranslations } from "@/components/language-provider";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MAX_IMPORT_BYTES, MANUAL_GENAI_SCHEMA_VERSION, parseManualGenaiImport, parseManualGenaiText, SHELFIE_GENAI_PROMPT, type ManualGenaiBook, type ManualGenaiImport } from "@/lib/manual-genai-import";

type OwnedCollection = { id: string; slug: string; name: string };
type ReviewBook = ManualGenaiBook & { included: boolean; authorText: string; categoryText: string };
const reviewBooks = (payload: ManualGenaiImport) => payload.books.map((book) => ({ ...book, included: true, authorText: book.authors.join("; "), categoryText: (book.categories ?? []).join("; ") }));

export function ShelfieReview({ userId, collections, initialDraft, initialPayload, discoverCovers = false, canImport = true }: {
  userId: string; collections: OwnedCollection[]; canImport?: boolean;
  initialDraft?: { id: string; payload: ManualGenaiImport };
  initialPayload?: ManualGenaiImport; discoverCovers?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [destination, setDestination] = useState(collections[0]?.id ?? "new");
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [raw, setRaw] = useState("");
  const [books, setBooks] = useState<ReviewBook[]>(initialDraft ? reviewBooks(initialDraft.payload) : initialPayload ? reviewBooks(initialPayload) : []);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(t("Importing…"));
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const includedCount = books.filter((book) => book.included).length;

  async function copyPrompt() {
    try { await navigator.clipboard.writeText(SHELFIE_GENAI_PROMPT); setCopied(true); }
    catch { setError(t("Select and copy the prompt manually.")); }
  }
  function preview() {
    setError(null);
    try {
      setBooks(reviewBooks(parseManualGenaiText(raw)));
      requestAnimationFrame(() => reviewRef.current?.focus());
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Validation failed.")); }
  }
  function edit(index: number, changes: Partial<ReviewBook>) {
    setBooks((current) => current.map((book, offset) => offset === index ? { ...book, ...changes } : book));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canImport) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    let payload: ManualGenaiImport;
    try {
      payload = parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: books.filter((book) => book.included).map(({ included: _included, authorText, categoryText, ...book }) => ({ ...book, authors: authorText.split(";").map((author) => author.trim()).filter(Boolean), ...(book.categories !== undefined || categoryText.trim() ? { categories: categoryText.split(";").map(tag => tag.trim()).filter(Boolean) } : {}) })) });
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Review the books.")); return; }
    setBusy(true); setPhase(t("Importing…"));
    let createdCollectionId: string | null = null;
    let importCompleted = false;
    let supabase: ReturnType<typeof createSupabaseBrowserClient> | undefined;
    let target = collections.find((collection) => collection.id === destination) ?? null;
    try {
      supabase = createSupabaseBrowserClient();
      if (destination === "new") {
        const name = String(form.get("collectionName") ?? "").trim();
        if (!name) throw new Error(t("Enter a collection name."));
        const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "collection";
        const created = await supabase.from("collections").insert({ owner_id: userId, slug: `${base}-${crypto.randomUUID().slice(0, 8)}`, name, description: String(form.get("collectionDescription") ?? "").trim() || null }).select("id,slug,name").single();
        if (created.error || !created.data) throw new Error(created.error?.message || t("Could not create the collection."));
        target = created.data; createdCollectionId = created.data.id;
      }
      if (!target) throw new Error(t("Choose a collection."));
      const imported = initialDraft
        ? await supabase.rpc("confirm_shelfie_draft", { target_draft_id: initialDraft.id, reviewed_payload: payload })
        : await supabase.rpc(discoverCovers ? "import_gemini_books" : "import_manual_genai_books", { target_collection_id: target.id, target_import_id: crypto.randomUUID(), payload });
      if (imported.error) throw new Error(imported.error.message);
      const result = imported.data as { imported: number; duplicate?: boolean; importId: string };
      importCompleted = true; setPhase(t("Books saved."));
      router.push(discoverCovers ? `/shelfies/gemini/covers?importId=${encodeURIComponent(result.importId)}` : `/collections/${target.slug}?imported=${result.imported}`);
      router.refresh();
    } catch (reason) {
      if (createdCollectionId && !importCompleted && supabase) await supabase.from("collections").delete().eq("id", createdCollectionId);
      setError(reason instanceof Error ? t(reason.message) : t("Import failed.")); setBusy(false);
    }
  }

  return <div className="genai-import-flow">
    {!initialDraft && !initialPayload && <>
      <section className="genai-step">
        <span className="step-number">1</span><h2>{t("Read the photo in your own AI chat")}</h2>
        <p>{t("Upload the photo there and send the prompt. Recognition uses your own AI account.")}</p>
        <button className="secondary-button" type="button" onClick={copyPrompt}>{copied ? t("Prompt copied") : t("Copy prompt")}</button>
        <details className="import-disclosure"><summary>{t("View prompt")}</summary><textarea className="prompt-box" readOnly value={SHELFIE_GENAI_PROMPT} rows={10} aria-label={t("Book extraction prompt")} /></details>
      </section>
      <section className="genai-step">
        <span className="step-number">2</span><h2>{t("Bring the response here")}</h2><p>{t("Paste the chat's JSON response. You can review and correct the books before adding them.")}</p>
        <div className="import-modes" aria-label={t("Import method")}>
          <button type="button" aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>{t("Paste response")}</button>
          <button type="button" aria-pressed={mode === "file"} onClick={() => setMode("file")}>{t("JSON file")}</button>
        </div>
        {mode === "paste" ? <><label htmlFor="ai-response">{t("AI response")}</label><textarea id="ai-response" className="prompt-box" value={raw} onChange={(event) => { setRaw(event.target.value); setBooks([]); }} rows={7} placeholder={'{ "schemaVersion": "mylibrary.shelfie.v1", "books": […] }'} spellCheck={false} /></> : <label className="shelfie-file">{t("JSON file · up to 1 MB")}<input type="file" accept="application/json,.json" onChange={async (event) => {
          setError(null); setBooks([]); setRaw("");
          const file = event.target.files?.[0]; if (!file) return;
          if (file.size > MAX_IMPORT_BYTES) { setError(t("The file must be smaller than 1 MB.")); return; }
          try { setRaw(await file.text()); } catch { setError(t("Could not read the file.")); }
        }} /></label>}
        <button type="button" className="primary-button" disabled={!raw.trim()} onClick={preview}>{t("Validate and preview")}</button>
        <p className="privacy-note">{t("Up to 100 books. Responses inside a JSON code block are also accepted.")}</p>
      </section>
    </>}
    {error && <p className="form-error" role="alert">{t(error)}</p>}
    {books.length > 0 && <form className="review-form" onSubmit={submit}>
      <h2 ref={reviewRef} tabIndex={-1}>{t("Review books")}</h2>
      <p role="status">{includedCount} {" " + t("of") + " "}{books.length} {" " + t("books selected. They have not been published yet.")}</p>
      <p>{t("Check titles and authors. Deselect any books you don't want to import.")}</p>
      <fieldset disabled={busy} className="review-fieldset">
        <legend className="sr-only">{t("Books to import")}</legend>
        {books.map((book, index) => <article key={book.position} className={`review-book${book.included ? "" : " is-excluded"}`}>
          <label className="choice-row"><input type="checkbox" checked={book.included} onChange={(event) => edit(index, { included: event.target.checked })} /><strong>{t("Book") + " "}{book.position}</strong></label>
          {(book.confidence < .8 || !book.authorText.trim() || book.notes) && <p className="review-warning">{t("Needs attention")}{book.notes ? `: ${book.notes}` : t(" — uncertain reading or unknown author.")}</p>}
          <div className="review-fields">
            <label>{t("Category tags") + " "}<small>{t("(separated by ;)")}</small><input value={book.categoryText} disabled={!book.included} onChange={event => edit(index,{ categoryText: event.target.value })} /></label>
            <label>{t("Title")}<input value={book.title} required={book.included} disabled={!book.included} maxLength={300} onChange={(event) => edit(index, { title: event.target.value })} /></label>
            <label>{t("Authors") + " "}<small>{t("(separated by ;)")}</small><input value={book.authorText} disabled={!book.included} onChange={(event) => edit(index, { authorText: event.target.value })} /></label>
          </div>
          <details className="import-disclosure"><summary>{t("ISBN and other details")}</summary><div className="review-fields">
            {([ ["subtitle", t("Subtitle")], ["publisher", t("Publisher")], ["language", t("Language")], ["series", t("Series")], ["volume", t("Volume")], ["editionStatement", t("Edition")], ["visibleIsbn", t("ISBN read from the photo")], ["isbn", t("ISBN verified online")], ["coverUrl", t("Public cover image URL")], ["notes", t("Notes")] ] as const).map(([field, label]) => <label key={field}>{label}<input value={book[field] ?? ""} disabled={!book.included} onChange={(event) => edit(index, { [field]: event.target.value || null })} /></label>)}
            <label>{t("Year")}<input type="number" min={1400} max={2100} value={book.publicationYear ?? ""} disabled={!book.included} onChange={(event) => edit(index, { publicationYear: event.target.value ? Number(event.target.value) : null })} /></label>
          </div></details>
        </article>)}
        {canImport && <section className="genai-step"><h2>{t("Destination")}</h2>
          <label htmlFor="destination">{t("Collection")}</label><select id="destination" value={destination} onChange={(event) => setDestination(event.target.value)} disabled={Boolean(initialDraft)}>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}{!initialDraft && <option value="new">{t("New collection")}</option>}</select>
          {destination === "new" && <div className="new-collection-fields"><label htmlFor="collection-name">{t("Collection name")}</label><input id="collection-name" name="collectionName" required maxLength={100} /><label htmlFor="collection-description">{t("Description (optional)")}</label><textarea id="collection-description" name="collectionDescription" maxLength={500} rows={2} /></div>}
          <p className="privacy-note">{discoverCovers ? t("After saving your books, Gemini will search for missing covers. You can follow progress on the next page.") : t("The import uses the supplied ISBN and cover. Backend searching starts only for books without a cover URL.")}</p>
          <button className="primary-button" type="submit" disabled={!includedCount}>{busy ? phase : t("Import {0} books", [includedCount])}</button>
        </section>}
      </fieldset>
      {!canImport && <p className="empty-admin">{t("This is a preview.") + " "}<Link href="/login?next=/shelfies">{t("Log in")}</Link> {" " + t("to import books into your collection.")}</p>}
    </form>}
  </div>;
}
