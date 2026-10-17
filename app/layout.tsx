import { getLocale, getTranslations } from "@/lib/i18n/server";
import { LanguageProvider, LanguageSwitcher } from "@/components/language-provider";
import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { AccountMenu } from "@/components/account-menu";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
  title: t("myLibrary · Public book collections"),
  description: t("Personal libraries and public book collections."),
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body><LanguageProvider locale={locale}><div className="global-navigation"><Link href="/" className="directory-brand"><span aria-hidden="true">m.</span>myLibrary</Link><Suspense fallback={<span className="account-placeholder" aria-hidden="true" />}><AccountMenu /></Suspense><LanguageSwitcher /></div>{children}<SiteFooter /></LanguageProvider></body>
    </html>
  );
}
