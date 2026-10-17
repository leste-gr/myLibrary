import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { getViewer } from "@/lib/catalogue-viewer";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { signOut } from "@/app/auth/actions";

export async function AccountMenu() {
  const t = await getTranslations();
  if (!isSupabaseConfigured()) return null;
  const user = await getViewer();
  return <nav className="account-menu" aria-label={t("Account")}>
    {user ? <>
      <span className="account-email">{user.email}</span>
      <Link href="/?view=mine">{t("My collections")}</Link>
      <Link href="/shelfies/connections">{t("Connected applications")}</Link>
      <form action={signOut}><button type="submit" className="secondary-button">{t("Log out")}</button></form>
    </> : <Link href="/login">{t("Log in / Register")}</Link>}
  </nav>;
}
