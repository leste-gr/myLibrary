import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";

export async function SiteFooter() {
  const t = await getTranslations();
  return <footer className="site-footer"><span>Shelfie Street</span><nav aria-label={t("Legal information")}><Link href="/privacy">{t("Privacy Policy")}</Link><Link href="/terms">{t("Terms of Service")}</Link></nav></footer>;
}
