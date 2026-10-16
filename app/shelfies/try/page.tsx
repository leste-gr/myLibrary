import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { ShelfieReview } from "@/components/shelfie-review";

export default async function TryShelfiePage() {
  const t = await getTranslations();
  return <main className="shelfie-shell"><Link href="/">{t("← All collections")}</Link><p className="eyebrow">{t("TRY AN IMPORT")}</p><h1>{t("From your AI to your library")}</h1><p className="shelfie-lead">{t("Try pasting and reviewing books. Nothing is saved or published on this page.")}</p><ShelfieReview userId="" collections={[]} canImport={false} /></main>;
}
