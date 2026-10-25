"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { updateCollection } from "@/app/collections/actions";
import { useTranslations } from "@/components/language-provider";

export function CollectionEditor({ slug, name: initialName, description: initialDescription }: {
  slug: string; name: string; description: string | null;
}) {
  const t = useTranslations();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [state, action, pending] = useActionState(updateCollection.bind(null, slug), { error: "" });
  return <form action={action} className="collection-editor shelfie-form">
    <label htmlFor="collection-name">{t("Collection name")}</label>
    <input id="collection-name" name="name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={pending} />
    <label htmlFor="collection-description">{t("Description (optional)")}</label>
    <textarea id="collection-description" name="description" rows={5} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} disabled={pending} />
    {state.error && <p className="form-error" role="alert">{t(state.error)}</p>}
    <div className="collection-editor-actions"><button className="primary-button" type="submit" disabled={pending}>{pending ? t("Saving…") : t("Save changes")}</button>
      <Link className="secondary-button" href={`/collections/${slug}`}>{t("Cancel")}</Link></div>
  </form>;
}
