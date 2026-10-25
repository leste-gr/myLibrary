"use client";

import { useTranslations } from "./language-provider";
import type { BookLoan } from "@/lib/book-loan";

export function BookLoanBadge({ loan }: { loan: BookLoan | null }) {
  const t = useTranslations();
  if (!loan) return null;
  return <div className="book-loan-state"><div className={`loan-badge loan-${loan.status}`}>
    <span>{loan.status === "loaned_out" ? t("Loaned out") : t("Loaned in")}</span>
    {loan.personName && <span className="loan-contact">{loan.status === "loaned_out" ? t("To {0}",[loan.personName]) : t("From {0}",[loan.personName])}</span>}
  </div></div>;
}
