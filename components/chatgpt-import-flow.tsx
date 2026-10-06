"use client";

import { FormEvent, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createChatGptImportSession, type ImportSessionState } from "@/app/shelfies/actions";

type Collection = { id: string; slug: string; name: string };
const initialState: ImportSessionState = {};

export function ChatGptImportFlow({ collections }: { collections: Collection[] }) {
  const router = useRouter();
  const [destination, setDestination] = useState(collections[0]?.id ?? "new");
  const [state, action, pending] = useActionState(createChatGptImportSession, initialState);
  const [json, setJson] = useState("");
  const [importing, setImporting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const prompt = state.code ? `I am importing books into myLibrary with one-time code ${state.code}. Analyze the shelfie I attach. Identify every readable physical book from left to right, top shelf to bottom shelf. Do not invent unreadable text or ISBNs. Return only JSON in this exact shape:\n{"books":[{"title":"","author":"","publisher":null,"language":null,"visibleIsbn":null,"confidence":0.0}]}` : "";

  async function submitJson(event: FormEvent) {
    event.preventDefault();
    if (!state.code) return;
    setClientError(null);
    setImporting(true);
    try {
      const parsed = JSON.parse(json);
      const response = await fetch("/api/chatgpt-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ importCode: state.code, books: parsed.books }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Η εισαγωγή απέτυχε.");
      router.push(`/collections/${state.collectionSlug}?chatgpt=imported&count=${result.imported}`);
      router.refresh();
    } catch (error) {
      setClientError(error instanceof Error ? error.message : "Μη έγκυρο JSON.");
      setImporting(false);
    }
  }

  if (state.code) return <section className="chatgpt-journey">
    <div className="journey-step"><span>1</span><div><h2>Άνοιξε το ChatGPT</h2><p>Ξεκίνησε μια νέα συνομιλία και επισύναψε τη shelfie σου εκεί. Η φωτογραφία δεν ανεβαίνει στο myLibrary.</p><a className="primary-button" href="https://chatgpt.com/" target="_blank" rel="noreferrer">Άνοιγμα ChatGPT ↗</a></div></div>
    <div className="journey-step"><span>2</span><div><h2>Αντέγραψε την οδηγία</h2><textarea readOnly rows={8} value={prompt} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="secondary-button" onClick={() => navigator.clipboard.writeText(prompt)}>Αντιγραφή οδηγίας</button><p className="import-code">Κωδικός: <strong>{state.code}</strong> · λήγει σε 30 λεπτά</p></div></div>
    <div className="journey-step"><span>3</span><div><h2>Επικόλλησε το JSON</h2><p>Για αυτό το πρώτο δοκιμαστικό ταξίδι, επικόλλησε εδώ την απάντηση του ChatGPT. Η Action έκδοση θα στέλνει τα ίδια δεδομένα αυτόματα.</p><form onSubmit={submitJson}><textarea value={json} onChange={(event) => setJson(event.target.value)} rows={12} required placeholder={'{"books":[…]}'} />{clientError && <p className="form-error" role="alert">{clientError}</p>}<button className="primary-button" disabled={importing}>{importing ? "Εισαγωγή…" : "Εισαγωγή βιβλίων"}</button></form></div></div>
  </section>;

  return <form className="shelfie-form" action={action}>
    <fieldset disabled={pending}><legend>Σε ποια συλλογή;</legend>{collections.map((collection) => <label className="choice-row" key={collection.id}><input type="radio" name="destination" value={collection.id} checked={destination === collection.id} onChange={() => setDestination(collection.id)} /><span>{collection.name}</span></label>)}<label className="choice-row"><input type="radio" name="destination" value="new" checked={destination === "new"} onChange={() => setDestination("new")} /><span>Νέα συλλογή</span></label></fieldset>
    {destination === "new" && <div className="new-collection-fields"><label htmlFor="collection-name">Όνομα συλλογής</label><input id="collection-name" name="collectionName" required maxLength={100} /><label htmlFor="collection-description">Περιγραφή <span>(προαιρετική)</span></label><textarea id="collection-description" name="collectionDescription" maxLength={500} rows={3} /></div>}
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    <button className="primary-button" disabled={pending}>{pending ? "Δημιουργία…" : "Δημιουργία κωδικού εισαγωγής"}</button>
  </form>;
}
