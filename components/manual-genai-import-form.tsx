"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MAX_IMPORT_BYTES, parseManualGenaiImport, SHELFIE_GENAI_PROMPT } from "@/lib/manual-genai-import";

type OwnedCollection = { id: string; slug: string; name: string };

function collectionSlug(name: string) {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "collection";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export function ManualGenaiImportForm({ userId, collections }: { userId: string; collections: OwnedCollection[] }) {
  const router = useRouter();
  const [destination, setDestination] = useState(collections[0]?.id ?? "new");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("Εισαγωγή…");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(SHELFIE_GENAI_PROMPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Δεν ήταν δυνατή η αντιγραφή. Επίλεξε το κείμενο και αντέγραψέ το χειροκίνητα.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const file = form.get("inventoryJson");
    if (!(file instanceof File) || !file.size) return void (setError("Επίλεξε το αρχείο JSON που δημιούργησε το GenAI chat."), setBusy(false));
    if (file.size > MAX_IMPORT_BYTES) return void (setError("Το αρχείο JSON πρέπει να είναι μικρότερο από 1 MB."), setBusy(false));

    const supabase = createSupabaseBrowserClient();
    let target = collections.find((collection) => collection.id === destination) ?? null;
    let createdCollectionId: string | null = null;
    let importCompleted = false;
    try {
      let decoded: unknown;
      try {
        decoded = JSON.parse(await file.text());
      } catch {
        throw new Error("Το αρχείο δεν περιέχει έγκυρο JSON.");
      }
      const payload = parseManualGenaiImport(decoded);
      if (destination === "new") {
        const name = String(form.get("collectionName") ?? "").trim();
        const description = String(form.get("collectionDescription") ?? "").trim();
        if (!name) throw new Error("Πρόσθεσε όνομα για τη νέα συλλογή.");
        const created = await supabase.from("collections").insert({ owner_id: userId, slug: collectionSlug(name), name, description: description || null }).select("id,slug,name").single();
        if (created.error || !created.data) throw new Error(created.error?.message || "Δεν δημιουργήθηκε η συλλογή.");
        target = created.data;
        createdCollectionId = created.data.id;
      }
      if (!target) throw new Error("Επίλεξε συλλογή.");
      const imported = await supabase.rpc("import_manual_genai_books", {
        target_collection_id: target.id,
        target_import_id: crypto.randomUUID(),
        payload,
      });
      if (imported.error) throw new Error(imported.error.message);
      const result = imported.data as { imported?: number; duplicate?: boolean } | null;
      if (result?.duplicate) throw new Error("Αυτό το JSON έχει ήδη εισαχθεί σε αυτή τη συλλογή.");
      const importedCount = result?.imported ?? payload.books.length;
      const importId = (imported.data as { importId?: string } | null)?.importId;
      importCompleted = true;
      setPhase("Αναζήτηση ISBN…");
      let matchingQuery = "matching=retry";
      if (importId) {
        try {
          const response = await fetch(`/api/imports/${importId}/match`, { method: "POST" });
          const match = await response.json() as { matched?: number; unresolved?: number; retryable?: number };
          if (response.ok) matchingQuery = `matched=${match.matched ?? 0}&unresolved=${match.unresolved ?? 0}&retryable=${match.retryable ?? 0}`;
        } catch {
          // The import is safe; the collection page offers a retry for Stage 2.
        }
      }
      router.push(`/collections/${target.slug}?imported=${importedCount}&${matchingQuery}${importId ? `&matchImport=${importId}` : ""}`);
      router.refresh();
    } catch (reason) {
      if (createdCollectionId && !importCompleted) await supabase.from("collections").delete().eq("id", createdCollectionId);
      setError(reason instanceof Error ? reason.message : "Η εισαγωγή απέτυχε.");
      setBusy(false);
    }
  }

  return <div className="genai-import-flow">
    <section className="genai-step">
      <div className="step-number">1</div>
      <div><h2>Χρησιμοποίησε το GenAI chat της επιλογής σου</h2><p>Ανέβασε τη shelfie απευθείας στο chat και στείλε το παρακάτω prompt. Το myLibrary δεν επικοινωνεί με το chat και δεν λαμβάνει τη φωτογραφία.</p></div>
      <textarea className="prompt-box" readOnly value={SHELFIE_GENAI_PROMPT} rows={18} aria-label="Prompt εξαγωγής βιβλίων" />
      <button className="secondary-button" type="button" onClick={copyPrompt}>{copied ? "Αντιγράφηκε" : "Αντιγραφή prompt"}</button>
    </section>

    <form className="shelfie-form genai-step" onSubmit={submit}>
      <div className="step-number">2</div>
      <div><h2>Ανέβασε το JSON</h2><p>Αποθήκευσε την καθαρή απάντηση του chat ως αρχείο <code>.json</code>. Θα ελεγχθεί πριν γίνει οποιαδήποτε αλλαγή.</p></div>
      <fieldset disabled={busy}><legend>Προορισμός</legend>{collections.map((collection) => <label className="choice-row" key={collection.id}><input type="radio" name="destination" value={collection.id} checked={destination === collection.id} onChange={() => setDestination(collection.id)} /><span>{collection.name}</span></label>)}<label className="choice-row"><input type="radio" name="destination" value="new" checked={destination === "new"} onChange={() => setDestination("new")} /><span>Νέα συλλογή</span></label></fieldset>
      {destination === "new" && <div className="new-collection-fields"><label htmlFor="collection-name">Όνομα συλλογής</label><input id="collection-name" name="collectionName" required maxLength={100} /><label htmlFor="collection-description">Περιγραφή <span>(προαιρετική)</span></label><textarea id="collection-description" name="collectionDescription" maxLength={500} rows={3} /></div>}
      <label className="shelfie-file" htmlFor="inventory-json"><strong>Αρχείο JSON</strong><span>mylibrary.shelfie.v1 · έως 100 βιβλία · έως 1 MB</span><input id="inventory-json" name="inventoryJson" type="file" accept="application/json,.json" required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? phase : "Έλεγχος και εισαγωγή βιβλίων"}</button>
    </form>
  </div>;
}
