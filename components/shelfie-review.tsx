"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MAX_IMPORT_BYTES, MANUAL_GENAI_SCHEMA_VERSION, parseManualGenaiImport, parseManualGenaiText, SHELFIE_GENAI_PROMPT, type ManualGenaiBook, type ManualGenaiImport } from "@/lib/manual-genai-import";

type OwnedCollection = { id: string; slug: string; name: string };
type ReviewBook = ManualGenaiBook & { included: boolean; authorText: string };
const reviewBooks = (payload: ManualGenaiImport) => payload.books.map((book) => ({ ...book, included: true, authorText: book.authors.join("; ") }));

export function ShelfieReview({ userId, collections, initialDraft, canImport = true }: {
  userId: string; collections: OwnedCollection[]; canImport?: boolean;
  initialDraft?: { id: string; payload: ManualGenaiImport };
}) {
  const router = useRouter();
  const [destination, setDestination] = useState(collections[0]?.id ?? "new");
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [raw, setRaw] = useState("");
  const [books, setBooks] = useState<ReviewBook[]>(initialDraft ? reviewBooks(initialDraft.payload) : []);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("Εισαγωγή…");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const includedCount = books.filter((book) => book.included).length;

  async function copyPrompt() {
    try { await navigator.clipboard.writeText(SHELFIE_GENAI_PROMPT); setCopied(true); }
    catch { setError("Επίλεξε και αντέγραψε το prompt χειροκίνητα."); }
  }
  function preview() {
    setError(null);
    try {
      setBooks(reviewBooks(parseManualGenaiText(raw)));
      requestAnimationFrame(() => reviewRef.current?.focus());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ο έλεγχος απέτυχε."); }
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
      payload = parseManualGenaiImport({ schemaVersion: MANUAL_GENAI_SCHEMA_VERSION, books: books.filter((book) => book.included).map(({ included: _included, authorText, ...book }) => ({ ...book, authors: authorText.split(";").map((author) => author.trim()).filter(Boolean) })) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Έλεγξε τα βιβλία."); return; }
    setBusy(true); setPhase("Εισαγωγή…");
    let createdCollectionId: string | null = null;
    let importCompleted = false;
    const supabase = createSupabaseBrowserClient();
    let target = collections.find((collection) => collection.id === destination) ?? null;
    try {
      if (destination === "new") {
        const name = String(form.get("collectionName") ?? "").trim();
        if (!name) throw new Error("Πρόσθεσε όνομα συλλογής.");
        const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "collection";
        const created = await supabase.from("collections").insert({ owner_id: userId, slug: `${base}-${crypto.randomUUID().slice(0, 8)}`, name, description: String(form.get("collectionDescription") ?? "").trim() || null }).select("id,slug,name").single();
        if (created.error || !created.data) throw new Error(created.error?.message || "Δεν δημιουργήθηκε η συλλογή.");
        target = created.data; createdCollectionId = created.data.id;
      }
      if (!target) throw new Error("Επίλεξε συλλογή.");
      const imported = initialDraft
        ? await supabase.rpc("confirm_shelfie_draft", { target_draft_id: initialDraft.id, reviewed_payload: payload })
        : await supabase.rpc("import_manual_genai_books", { target_collection_id: target.id, target_import_id: crypto.randomUUID(), payload });
      if (imported.error) throw new Error(imported.error.message);
      const result = imported.data as { imported: number; duplicate?: boolean; importId: string };
      importCompleted = true; setPhase("Αναζήτηση ISBN…");
      let matchingQuery = "matching=retry";
      try {
        const response = await fetch(`/api/imports/${result.importId}/match`, { method: "POST" });
        const match = await response.json() as { matched?: number; unresolved?: number; retryable?: number };
        if (response.ok) matchingQuery = `matched=${match.matched ?? 0}&unresolved=${match.unresolved ?? 0}&retryable=${match.retryable ?? 0}`;
      } catch { /* Import is safe; matching can be retried on the collection page. */ }
      router.push(`/collections/${target.slug}?imported=${result.imported}&${matchingQuery}&matchImport=${result.importId}`);
      router.refresh();
    } catch (reason) {
      if (createdCollectionId && !importCompleted) await supabase.from("collections").delete().eq("id", createdCollectionId);
      setError(reason instanceof Error ? reason.message : "Η εισαγωγή απέτυχε."); setBusy(false);
    }
  }

  return <div className="genai-import-flow">
    {!initialDraft && <>
      <section className="genai-step">
        <span className="step-number">1</span><h2>Διάβασε τη φωτογραφία στο δικό σου AI chat</h2>
        <p>Ανέβασε εκεί τη φωτογραφία και στείλε το prompt. Η αναγνώριση χρησιμοποιεί τον δικό σου λογαριασμό AI.</p>
        <button className="secondary-button" type="button" onClick={copyPrompt}>{copied ? "Το prompt αντιγράφηκε" : "Αντιγραφή prompt"}</button>
        <details className="import-disclosure"><summary>Προβολή prompt</summary><textarea className="prompt-box" readOnly value={SHELFIE_GENAI_PROMPT} rows={10} aria-label="Prompt εξαγωγής βιβλίων" /></details>
      </section>
      <section className="genai-step">
        <span className="step-number">2</span><h2>Φέρε την απάντηση εδώ</h2><p>Επικόλλησε το JSON του chat. Θα δεις και θα διορθώσεις τα βιβλία πριν προστεθούν.</p>
        <div className="import-modes" aria-label="Τρόπος εισαγωγής">
          <button type="button" aria-pressed={mode === "paste"} onClick={() => setMode("paste")}>Επικόλληση απάντησης</button>
          <button type="button" aria-pressed={mode === "file"} onClick={() => setMode("file")}>Αρχείο JSON</button>
        </div>
        {mode === "paste" ? <><label htmlFor="ai-response">Απάντηση AI</label><textarea id="ai-response" className="prompt-box" value={raw} onChange={(event) => { setRaw(event.target.value); setBooks([]); }} rows={7} placeholder={'{ "schemaVersion": "mylibrary.shelfie.v1", "books": […] }'} spellCheck={false} /></> : <label className="shelfie-file">Αρχείο JSON · έως 1 MB<input type="file" accept="application/json,.json" onChange={async (event) => {
          setError(null); setBooks([]); setRaw("");
          const file = event.target.files?.[0]; if (!file) return;
          if (file.size > MAX_IMPORT_BYTES) { setError("Το αρχείο πρέπει να είναι μικρότερο από 1 MB."); return; }
          try { setRaw(await file.text()); } catch { setError("Δεν ήταν δυνατή η ανάγνωση του αρχείου."); }
        }} /></label>}
        <button type="button" className="primary-button" disabled={!raw.trim()} onClick={preview}>Έλεγχος και προεπισκόπηση</button>
        <p className="privacy-note">Έως 100 βιβλία. Οι απαντήσεις μέσα σε ένα πλαίσιο κώδικα JSON γίνονται επίσης δεκτές.</p>
      </section>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {books.length > 0 && <form className="review-form" onSubmit={submit}>
      <h2 ref={reviewRef} tabIndex={-1}>Έλεγχος βιβλίων</h2>
      <p role="status">{includedCount} από {books.length} βιβλία επιλεγμένα. Δεν έχουν δημοσιευτεί ακόμη.</p>
      <p>Έλεγξε τίτλους και συγγραφείς. Αποεπίλεξε όσα δεν θέλεις να εισαγάγεις.</p>
      <fieldset disabled={busy} className="review-fieldset">
        <legend className="sr-only">Βιβλία προς εισαγωγή</legend>
        {books.map((book, index) => <article key={book.position} className={`review-book${book.included ? "" : " is-excluded"}`}>
          <label className="choice-row"><input type="checkbox" checked={book.included} onChange={(event) => edit(index, { included: event.target.checked })} /><strong>Βιβλίο {book.position}</strong></label>
          {(book.confidence < .8 || !book.authorText.trim() || book.notes) && <p className="review-warning">Χρειάζεται προσοχή{book.notes ? `: ${book.notes}` : " — αβέβαιη ανάγνωση ή άγνωστος συγγραφέας."}</p>}
          <div className="review-fields">
            <label>Τίτλος<input value={book.title} required={book.included} disabled={!book.included} maxLength={300} onChange={(event) => edit(index, { title: event.target.value })} /></label>
            <label>Συγγραφείς <small>(χωρισμένοι με ;)</small><input value={book.authorText} disabled={!book.included} onChange={(event) => edit(index, { authorText: event.target.value })} /></label>
          </div>
          <details className="import-disclosure"><summary>ISBN και άλλα στοιχεία</summary><div className="review-fields">
            {([ ["subtitle", "Υπότιτλος"], ["publisher", "Εκδότης"], ["language", "Γλώσσα"], ["series", "Σειρά"], ["volume", "Τόμος"], ["editionStatement", "Έκδοση"], ["visibleIsbn", "ISBN που διαβάστηκε στη φωτογραφία"], ["notes", "Σημειώσεις"] ] as const).map(([field, label]) => <label key={field}>{label}<input value={book[field] ?? ""} disabled={!book.included} onChange={(event) => edit(index, { [field]: event.target.value || null })} /></label>)}
            <label>Έτος<input type="number" min={1400} max={2100} value={book.publicationYear ?? ""} disabled={!book.included} onChange={(event) => edit(index, { publicationYear: event.target.value ? Number(event.target.value) : null })} /></label>
          </div></details>
        </article>)}
        {canImport && <section className="genai-step"><h2>Προορισμός</h2>
          <label htmlFor="destination">Συλλογή</label><select id="destination" value={destination} onChange={(event) => setDestination(event.target.value)} disabled={Boolean(initialDraft)}>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}{!initialDraft && <option value="new">Νέα συλλογή</option>}</select>
          {destination === "new" && <div className="new-collection-fields"><label htmlFor="collection-name">Όνομα συλλογής</label><input id="collection-name" name="collectionName" required maxLength={100} /><label htmlFor="collection-description">Περιγραφή (προαιρετική)</label><textarea id="collection-description" name="collectionDescription" maxLength={500} rows={2} /></div>}
          <p className="privacy-note">Η εισαγωγή προσθέτει τα επιλεγμένα βιβλία στη συλλογή και ξεκινά την αναζήτηση ISBN.</p>
          <button className="primary-button" type="submit" disabled={!includedCount}>{busy ? phase : `Εισαγωγή ${includedCount} βιβλίων`}</button>
        </section>}
      </fieldset>
      {!canImport && <p className="empty-admin">Αυτή είναι προεπισκόπηση. <Link href="/login?next=/shelfies">Συνδέσου</Link> για να εισαγάγεις βιβλία στη συλλογή σου.</p>}
    </form>}
  </div>;
}
