"use client";
import { useTranslations } from "@/components/language-provider";

import { deleteBook } from "@/app/admin/actions";

export function DeleteBookButton({
  collectionId,
  collectionSlug,
  legacyId,
  title,
}: {
  collectionId: string;
  collectionSlug: string;
  legacyId: string;
  title: string;
}) {
  const t = useTranslations();
  return <form action={deleteBook} onSubmit={(event) => {
    if (!window.confirm(t("Permanently delete “{0}” from the collection?", [title]))) event.preventDefault();
  }}>
    <input type="hidden" name="collectionId" value={collectionId} />
    <input type="hidden" name="collectionSlug" value={collectionSlug} />
    <input type="hidden" name="legacyId" value={legacyId} />
    <button className="delete-book-button" type="submit">{t("Delete book")}</button>
  </form>;
}
