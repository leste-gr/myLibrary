"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "./language-provider";
import { BookCoverImage } from "./book-cover-image";
import { previewIsbnBook, addIsbnBook } from "@/app/collections/[slug]/add/actions";
import { startIsbnCamera } from "@/lib/isbn-camera";
import { canonicalIsbn } from "@/lib/isbn";
import type { IsbnEditionMetadata } from "@/lib/isbn-edition";

export function AddIsbnBook({ slug }: { slug: string }) {
  const t = useTranslations();
  const [isbn, setIsbn] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ isbn: string; metadata: IsbnEditionMetadata } | null>(null);
  const [saved, setSaved] = useState<{ legacyId: string; duplicate: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const video = useRef<HTMLVideoElement>(null);
  const requestId = useRef("");

  function lookup(value: string) {
    setCameraOpen(false);
    setError(""); setPreview(null); setSaved(null);
    const valid = canonicalIsbn(value);
    if (!valid) { setError("Invalid ISBN-10 or ISBN-13."); return; }
    setIsbn(valid);
    requestId.current = crypto.randomUUID();
    startTransition(async () => {
      try {
        const result = await previewIsbnBook(slug, valid);
        if (result.error) setError(result.error);
        else if (result.isbn && result.metadata) setPreview({ isbn: result.isbn, metadata: result.metadata });
      } catch { setError("Could not look up this ISBN. Please try again."); }
    });
  }

  useEffect(() => {
    if (!cameraOpen || !video.current) return;
    const controller = new AbortController();
    const hide = () => { if (document.hidden) { controller.abort(); setCameraOpen(false); } };
    document.addEventListener("visibilitychange", hide);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(true); setCameraOpen(false);
    } else {
      startIsbnCamera(video.current, code => lookup(code), controller.signal).catch(() => {
        if (!controller.signal.aborted) { setCameraError(true); setCameraOpen(false); }
      });
    }
    return () => { controller.abort(); document.removeEventListener("visibilitychange", hide); };
    // Each camera session uses the current collection and stops after one ISBN.
  }, [cameraOpen, slug]);

  if (saved) return <section className="genai-step isbn-saved" role="status">
    <h2>{saved.duplicate ? t("This book is already in your collection.") : t("Book added to your collection.")}</h2>
    <div className="isbn-actions"><Link className="button-link" href={`/collections/${slug}#book-${encodeURIComponent(saved.legacyId)}`}>{t("View book in collection")}</Link>
      <button className="secondary-button" onClick={() => { setSaved(null); setPreview(null); setIsbn(""); setError(""); }}>{t("Add another book")}</button></div>
  </section>;

  return <div className="isbn-add-flow">
    <section className="genai-step">
      <h2>{t("Scan or enter an ISBN")}</h2>
      <p>{t("Camera images stay on your device. Only the ISBN is used to look up book details.")}</p>
      <div className="isbn-actions">
        <button className="button-link" type="button" disabled={pending} onClick={() => { setCameraError(false); setCameraOpen(value => !value); }}>{cameraOpen ? t("Stop camera") : t("Scan ISBN barcode")}</button>
      </div>
      {cameraError && <p className="isbn-feedback" role="alert">{t("Could not open the camera. Allow camera access in your browser, or enter the ISBN below.")}</p>}
      <div className="isbn-camera" hidden={!cameraOpen}>
        <video ref={video} autoPlay muted playsInline aria-label={t("ISBN barcode camera preview")} />
        <p role="status">{t("Point the rear camera at the book’s ISBN barcode. Keep it steady and well lit.")}</p>
      </div>
      <form className="isbn-lookup" onSubmit={event => { event.preventDefault(); lookup(isbn); }}>
        <label htmlFor="new-book-isbn">{t("ISBN-10 or ISBN-13")}</label>
        <div className="isbn-input-row"><input id="new-book-isbn" name="isbn" value={isbn} onChange={event => setIsbn(event.target.value)} maxLength={32} inputMode="text" autoComplete="off" required disabled={pending} />
          <button className="button-link" type="submit" disabled={pending}>{pending ? t("Please wait…") : t("Look up book")}</button></div>
      </form>
    </section>
    {error && <p className="isbn-feedback" role="alert">{t(error)}</p>}
    {pending && <p role="status">{t("Please wait…")}</p>}
    {preview && <section className="genai-step">
      <h2>{t("Review book details")}</h2>
      {!preview.metadata.title && <p role="status">{t("No title was found for this ISBN. Enter the book details to add it.")}</p>}
      <div className="isbn-preview"><BookCoverImage src={`/api/covers/${preview.isbn}`} alt="" fallbackAlt={t("Cover unavailable")} width={120} height={180} /><p>ISBN: {preview.isbn}</p></div>
      <form key={preview.isbn} className="isbn-book-details" onSubmit={event => {
        event.preventDefault();
        setCameraOpen(false);
        const form = new FormData(event.currentTarget);
        form.set("isbn", preview.isbn); form.set("requestId", requestId.current);
        setError("");
        startTransition(async () => {
          try {
            const result = await addIsbnBook(slug, form);
            if (result.error) setError(result.error);
            else if (result.legacyId) setSaved({ legacyId: result.legacyId, duplicate: Boolean(result.duplicate) });
          } catch { setError("Could not add this book. Please try again."); }
        });
      }}>
        <fieldset disabled={pending}>
          <label htmlFor="isbn-title">{t("Title")}</label><input id="isbn-title" name="title" defaultValue={preview.metadata.title ?? ""} required maxLength={300} />
          <label htmlFor="isbn-authors">{t("Authors (one per line)")}</label><textarea id="isbn-authors" name="authors" defaultValue={preview.metadata.authors.join("\n")} rows={3} maxLength={1610} />
          <label htmlFor="isbn-publisher">{t("Publisher")}</label><input id="isbn-publisher" name="publisher" defaultValue={preview.metadata.publishers[0] ?? ""} maxLength={200} />
          <label htmlFor="isbn-language">{t("Language")}</label><input id="isbn-language" name="language" defaultValue={preview.metadata.language ?? ""} maxLength={40} />
          <label htmlFor="isbn-published">{t("Publication date")}</label><input id="isbn-published" name="publishedDate" defaultValue={preview.metadata.publishedDate ?? ""} maxLength={80} />
          <div className="isbn-actions"><button className="button-link" type="submit">{pending ? t("Please wait…") : t("Add to collection")}</button><Link href={`/collections/${slug}`}>{t("Cancel")}</Link></div>
        </fieldset>
      </form>
    </section>}
  </div>;
}
