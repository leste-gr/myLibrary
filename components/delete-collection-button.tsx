"use client";
import { useTranslations } from "@/components/language-provider";

import { deleteCollection } from "@/app/admin/actions";

export function DeleteCollectionButton({ collectionId, collectionName }: { collectionId: string; collectionName: string }) {
  const t = useTranslations();
  return <form action={deleteCollection} onSubmit={(event) => {
    if (!window.confirm(t("Permanently delete the collection “{0}” and all its books?", [collectionName]))) event.preventDefault();
  }}>
    <input type="hidden" name="collectionId" value={collectionId} />
    <button className="danger-button" type="submit">{t("Delete collection")}</button>
  </form>;
}
