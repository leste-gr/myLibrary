"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "./language-provider";
import type { BookLoan, LoanStatus } from "@/lib/book-loan";

export function BookLoanEditor({ slug,legacyId,loan }: {
  slug: string; legacyId: string; loan: BookLoan | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [saved,setSaved] = useState(loan);
  const [status,setStatus] = useState<LoanStatus>(loan?.status ?? "none");
  const [name,setName] = useState(loan?.personName ?? "");
  const [error,setError] = useState("");
  const [notice,setNotice] = useState(false);
  const [pending,startTransition] = useTransition();
  useEffect(() => { setSaved(loan); setStatus(loan?.status ?? "none"); setName(loan?.personName ?? ""); },[loan]);
  return <section className="book-loan-editor" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>{t("Loan status")}</h2>
    <form id={`${id}-form`} className="loan-form" onSubmit={event => {
      event.preventDefault(); setError(""); setNotice(false);
      const personName = status === "none" ? null : name.trim() || null;
      startTransition(async () => {
        try {
          const response = await fetch("/api/book-loan",{ method: "POST",credentials: "same-origin",
            headers: { "Content-Type": "application/json" },body: JSON.stringify({ slug,legacyId,status,personName }) });
          const result = await response.json();
          if (!response.ok || result.error) { setError(result.error || "Could not save loan details. Please try again."); return; }
          setSaved(status === "none" ? null : { status,personName }); setNotice(true); router.refresh();
        } catch { setError("Could not save loan details. Please try again."); }
      });
    }}>
      <fieldset disabled={pending}>
        <label htmlFor={`${id}-status`}>{t("Loan status")}</label>
        <select id={`${id}-status`} value={status} onChange={event => {
          const value = event.target.value;
          if (value === "none" || value === "loaned_out" || value === "loaned_in") { setStatus(value); setNotice(false); if (value === "none") setName(""); }
        }}>
          <option value="none">{t("Not on loan")}</option><option value="loaned_out">{t("Loaned out")}</option><option value="loaned_in">{t("Loaned in")}</option>
        </select>
        {status !== "none" && <><label htmlFor={`${id}-name`}>{status === "loaned_out" ? t("Borrower's name (optional)") : t("Lender's name (optional)")}</label>
          <input id={`${id}-name`} type="text" maxLength={120} value={name} onChange={event => { setName(event.target.value); setNotice(false); }} autoComplete="off" />
        </>}
        <div className="loan-actions"><button className="secondary-button" type="submit">{pending ? t("Saving…") : t("Save loan")}</button>
          <button className="loan-cancel" type="button" onClick={() => { setStatus(saved?.status ?? "none"); setName(saved?.personName ?? ""); setError(""); setNotice(false); }}>{t("Cancel")}</button></div>
      </fieldset>
      {error && <p className="reading-error" role="alert">{t(error)}</p>}
    </form>
    {notice && <p role="status">{t("Loan details saved.")}</p>}
  </section>;
}
