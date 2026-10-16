"use client";

import { createContext, useContext, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, translator, type Locale } from "@/lib/i18n/shared";

const LanguageContext = createContext<Locale>("en");
export function LanguageProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LanguageContext.Provider value={locale}>{children}</LanguageContext.Provider>;
}
export function useLocale() { return useContext(LanguageContext); }
export function useTranslations() {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <label className="language-switcher"><span>{locale === "en" ? "Language" : "Γλώσσα"}</span>
    <select aria-label={locale === "en" ? "Interface language" : "Γλώσσα περιβάλλοντος"} value={locale} disabled={pending} onChange={(event) => {
      const nextLocale = event.target.value === "el" ? "el" : "en";
      document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      startTransition(() => router.refresh());
    }}><option value="en" lang="en">English</option><option value="el" lang="el">Ελληνικά</option></select>
  </label>;
}
