import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { legalUpdated } from "@/lib/legal-contact";

export async function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const t = await getTranslations();
  return <main className="legal-page">
    <Link href="/">{t("← myLibrary")}</Link>
    <p className="eyebrow">{t("MYLIBRARY")}</p>
    <h1>{title}</h1>
    <p className="legal-updated">{t("Last updated:") + " "}{t(legalUpdated)}</p>
    <nav className="legal-nav" aria-label={t("Legal information")}><Link href="/privacy">{t("Privacy Policy")}</Link><Link href="/terms">{t("Terms of Service")}</Link></nav>
    <article>{children}</article>
  </main>;
}
