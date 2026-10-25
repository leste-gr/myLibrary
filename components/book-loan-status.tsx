"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "./language-provider";
import type { BookLoan, LoanStatus } from "@/lib/book-loan";

export function BookLoanStatus({ slug,legacyId,title,loan,disabled=false,onSaved }: {
  slug: string; legacyId: string; title: string; loan: BookLoan | null; disabled?: boolean; onSaved: (loan: BookLoan | null) => void;
}) {
  const t = useTranslations();
  const id = useId();
  const [editing,setEditing] = useState(false);
  const [status,setStatus] = useState<LoanStatus>(loan?.status ?? "none");
  const [name,setName] = useState(loan?.personName ?? "");
  const [error,setError] = useState("");
  const [pending,startTransition] = useTransition();
  const label = loan?.status === "loaned_out" ? t("Loaned out") : loan?.status === "loaned_in" ? t("Loaned in") : t("Not on loan");
  return <div className="book-loan-state">
    <p className="loan-label">{t("Loan status")}</p>
    <button type="button" className={`loan-summary loan-${loan?.status ?? "none"}`} aria-label={t("Loan details for {0}",[title])}
      aria-expanded={editing} aria-controls={`${id}-form`} disabled={disabled || pending} onClick={() => {
        setStatus(loan?.status ?? "none"); setName(loan?.personName ?? ""); setError(""); setEditing(!editing);
      }}>
      <span>{label}</span>{loan?.personName && <span className="loan-contact">{loan.status === "loaned_out" ? t("To {0}",[loan.personName]) : t("From {0}",[loan.personName])}</span>}
    </button>
    {editing && <form id={`${id}-form`} className="loan-form" onSubmit={event => {
      event.preventDefault(); setError("");
      const personName = status === "none" ? null : name.trim() || null;
      startTransition(async () => {
        try {
          const response = await fetch("/api/book-loan",{ method: "POST",credentials: "same-origin",
            headers: { "Content-Type": "application/json" },body: JSON.stringify({ slug,legacyId,status,personName }) });
          const result = await response.json();
          if (!response.ok || result.error) { setError(result.error || "Could not save loan details. Please try again."); return; }
          onSaved(status === "none" ? null : { status,personName }); setEditing(false);
        } catch { setError("Could not save loan details. Please try again."); }
      });
    }}>
      <fieldset disabled={disabled || pending}>
        <label htmlFor={`${id}-status`}>{t("Loan status")}</label>
        <select id={`${id}-status`} value={status} onChange={event => {
          const value = event.target.value;
          if (value === "none" || value === "loaned_out" || value === "loaned_in") { setStatus(value); if (value === "none") setName(""); }
        }}>
          <option value="none">{t("Not on loan")}</option><option value="loaned_out">{t("Loaned out")}</option><option value="loaned_in">{t("Loaned in")}</option>
        </select>
        {status !== "none" && <><label htmlFor={`${id}-name`}>{status === "loaned_out" ? t("Borrower's name (optional)") : t("Lender's name (optional)")}</label>
          <input id={`${id}-name`} type="text" maxLength={120} value={name} onChange={event => setName(event.target.value)} autoComplete="off" />
        </>}
        <div className="loan-actions"><button className="secondary-button" type="submit">{pending ? t("Saving…") : t("Save loan")}</button>
          <button className="loan-cancel" type="button" onClick={() => { setEditing(false); setError(""); }}>{t("Cancel")}</button></div>
      </fieldset>
      {error && <p className="reading-error" role="alert">{t(error)}</p>}
    </form>}
  </div>;
}
