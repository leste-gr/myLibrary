"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "./language-provider";
import { uploadBookCover } from "@/app/admin/actions";
import { MAX_COVER_UPLOAD_BYTES } from "@/lib/book-cover";

function UploadButton() {
  const t = useTranslations();
  const { pending } = useFormStatus();
  return <button className="primary-button" type="submit" disabled={pending}>{pending ? t("Uploading…") : t("Upload cover")}</button>;
}

export function CoverUploadForm({ copyId, legacyId, collectionSlug }: { copyId: string; legacyId: string; collectionSlug: string }) {
  const t = useTranslations();
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return <section className="cover-upload">
    <h2>{t("Upload your own cover")}</h2>
    <p>{t("Your image replaces the current cover for this book and is kept instead of automated cover choices.")}</p>
    <form action={uploadBookCover}>
      <input type="hidden" name="copyId" value={copyId} />
      <input type="hidden" name="legacyId" value={legacyId} />
      <input type="hidden" name="collectionSlug" value={collectionSlug} />
      <label htmlFor="cover-upload">{t("Cover image")}</label>
      <input id="cover-upload" name="cover" type="file" accept="image/jpeg,image/png,image/webp" required
        aria-describedby="cover-upload-help" onChange={(event) => {
          const file = event.target.files?.[0];
          setError("");
          if (file && file.size > MAX_COVER_UPLOAD_BYTES) {
            setError(t("The cover image must be 4 MB or smaller."));
            event.target.value = "";
            setPreview(null);
          } else setPreview(file ? URL.createObjectURL(file) : null);
        }} />
      <small id="cover-upload-help">{t("JPG, PNG or WebP, up to 4 MB.")}</small>
      {error && <p className="form-error" role="alert">{error}</p>}
      {preview && <img className="cover-upload-preview" src={preview} alt={t("New cover preview")} />}
      <UploadButton />
    </form>
  </section>;
}
