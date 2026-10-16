import { getLocale, getTranslations } from "@/lib/i18n/server";
import { LanguageProvider, LanguageSwitcher } from "@/components/language-provider";
import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { AccountMenu } from "@/components/account-menu";

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
      <body><LanguageProvider locale={locale}><div className="global-navigation"><AccountMenu /><LanguageSwitcher /></div>{children}<SiteFooter /></LanguageProvider></body>
    </html>
  );
}
