import { getTranslations } from "@/lib/i18n/server";
export default async function RadarLoading() {
  const t = await getTranslations();
  return <main className="radar-shell catalogue-shell"><p role="status">{t("Loading books…")}</p></main>;
}
