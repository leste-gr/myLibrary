"use client";

import { useFormStatus } from "react-dom";
import { useTranslations } from "./language-provider";
import { searchBookIsbnCandidates } from "@/app/admin/actions";

function SearchButton() {
  const t = useTranslations();
  const { pending } = useFormStatus();
  return <button className="primary-button" type="submit" disabled={pending}>
    {pending ? t("Searching ISBN candidates…") : t("Find ISBN candidates")}
  </button>;
}

export function IsbnCandidateSearchForm({ copyId, legacyId, collectionSlug }: { copyId: string; legacyId: string; collectionSlug: string }) {
  const t = useTranslations();
  return <section className="cover-upload">
    <h2>{t("Find ISBN candidates")}</h2>
    <p>{t("Search this book again. Results are ranked for your review; the ISBN and book status stay unchanged.")}</p>
    <form action={searchBookIsbnCandidates}>
      <input type="hidden" name="copyId" value={copyId} />
      <input type="hidden" name="legacyId" value={legacyId} />
      <input type="hidden" name="collectionSlug" value={collectionSlug} />
      <SearchButton />
    </form>
  </section>;
}
