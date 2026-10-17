import { CollectionContentsSkeleton } from "@/components/catalogue-loading";
import { getTranslations } from "@/lib/i18n/server";
export default async function Loading() {
  const t = await getTranslations();
  return <CollectionContentsSkeleton label={t("Loading books…")} />;
}
