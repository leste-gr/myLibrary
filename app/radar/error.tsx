"use client";
import { useTranslations } from "@/components/language-provider";
export default function RadarError({ reset }: { reset: () => void }) {
  const t = useTranslations();
  return <main className="radar-shell catalogue-shell"><p role="alert">{t("Unable to load your radar books. Please try again.")}</p><button className="button-link" onClick={reset}>{t("Try again")}</button></main>;
}
