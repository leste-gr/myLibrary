"use client";
import { useTranslations } from "@/components/language-provider";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations();
  return <main className="directory-main">
    <h1>{t("This page could not be loaded.")}</h1>
    <p>{t("The data is unavailable right now. Please try again shortly.")}</p>
    <button type="button" onClick={reset}>{t("Try again")}</button>
  </main>;
}
