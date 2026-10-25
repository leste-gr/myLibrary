export type LoanStatus = "none" | "loaned_out" | "loaned_in";
export type BookLoan = { status: Exclude<LoanStatus,"none">; personName: string | null };
export type BookLoanChange = { slug: string; legacyId: string; status: LoanStatus; personName: string | null };
export function parseBookLoanChange(value: unknown): BookLoanChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { slug, legacyId, status, personName } = value as Record<string,unknown>;
  if (typeof slug !== "string" || !slug || slug.length>200 || typeof legacyId !== "string" || !legacyId || legacyId.length>200
    || (status !== "none" && status !== "loaned_out" && status !== "loaned_in")
    || (personName != null && typeof personName !== "string")) return null;
  const name = typeof personName === "string" ? personName.trim() : "";
  if ([...name].length>120) return null;
  return { slug,legacyId,status,personName: status === "none" ? null : name || null };
}
