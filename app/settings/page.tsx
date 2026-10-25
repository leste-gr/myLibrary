import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/catalogue-viewer";
import { getTranslations } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getViewer();
  if (!user) redirect("/login?next=%2Fsettings");
  const t = await getTranslations();

  return <main className="shelfie-shell settings-shell">
    <Link href="/?view=mine">{t("My collections")}</Link>
    <h1>{t("Settings")}</h1>
    <section className="genai-step" aria-labelledby="sign-in-email">
      <h2 id="sign-in-email">{t("Sign-in email")}</h2>
      <p className="settings-email">{user.email}</p>
      <p>{t("Your account uses this email to sign in. No additional profile information is needed.")}</p>
    </section>
    <p><Link className="secondary-button" href="/shelfies/connections">{t("Connected applications")}</Link></p>
  </main>;
}
