"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "./language-provider";
import { changeReadingStatus } from "@/app/collections/reading-status-actions";
import { isReadingStatus, type ReadingStatus as Status } from "@/lib/reading-status";

export function BookReadingStatus({ slug, legacyId, title, status, canEdit, disabled = false, onSaved }: {
  slug: string; legacyId: string; title: string; status: Status; canEdit: boolean; disabled?: boolean; onSaved?: (status: Status) => void;
}) {
  const t = useTranslations();
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => { setCurrent(status); }, [status]);
  const label = current === "read" ? t("Read") : current === "radar" ? t("On my radar") : t("Unread");
  if (!canEdit) return <div className="book-reading-state"><span className={`reading-badge reading-badge-${current}`}>{label}</span></div>;
  const id = `reading-status-${slug}-${legacyId}`;
  return <div className="book-reading-state">
    <label htmlFor={id}>{t("Reading status")}</label>
    <select id={id} aria-label={t("Reading status for {0}", [title])} aria-describedby={error ? `${id}-error` : undefined}
      className={`reading-select reading-badge-${current}`} value={current} disabled={pending || disabled} onChange={event => {
        const next = event.target.value;
        if (!isReadingStatus(next)) return;
        const previous = current;
        setCurrent(next); setError("");
        startTransition(async () => {
          try {
            const result = await changeReadingStatus(slug, legacyId, next);
            if (result.error) { setCurrent(previous); setError(result.error); }
            else onSaved?.(next);
          } catch { setCurrent(previous); setError("Could not save reading status. Please try again."); }
        });
      }}>
      <option value="unread">{t("Unread")}</option><option value="read">{t("Read")}</option><option value="radar">{t("On my radar")}</option>
    </select>
    {pending && <span className="reading-save-status" role="status">{t("Saving…")}</span>}
    {error && <p id={`${id}-error`} className="reading-error" role="alert">{t(error)}</p>}
  </div>;
}
