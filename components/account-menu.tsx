import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { getViewer } from "@/lib/catalogue-viewer";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { CompactMenu } from "@/components/compact-menu";
import { signOut } from "@/app/auth/actions";

export async function AccountMenu() {
  const t = await getTranslations();
  if (!isSupabaseConfigured()) return null;
  const user = await getViewer();
  return <nav className="account-menu" aria-label={t("Account")}>
    {user ? <>
      <CompactMenu className="collections-menu" label={<>{t("My collections")} <span aria-hidden="true">⌄</span></>}>
        <Link href="/?view=mine">{t("My collections")}</Link>
        <Link href="/">{t("All collections")}</Link>
      </CompactMenu>
      <CompactMenu className="profile-menu" label={<><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg><span className="sr-only">{t("Account")}</span></>}>
      <span className="account-email">{user.email}</span>
      <Link href="/radar">{t("On my radar")}</Link>
      <Link href="/shelfies/connections">{t("Connected applications")}</Link>
      <form action={signOut}><button type="submit" className="secondary-button">{t("Log out")}</button></form>
      </CompactMenu>
    </> : <Link href="/login">{t("Log in / Register")}</Link>}
  </nav>;
}
