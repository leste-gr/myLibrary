import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath, MIN_PASSWORD_LENGTH } from "@/lib/email-auth";
import { setNewPassword } from "./actions";

export const dynamic = "force-dynamic";
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; updated?: string }> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(emailAuthPath("/forgot-password", next, { error: t("Open a valid password reset link from your email.") }));
  if (params.updated === "1") return <main className="login-card"><h1>{t("Password changed")}</h1><p role="status">{t("Your new password has been saved.")}</p><Link className="button-link" href={next ?? "/login"}>{t("Continue")}</Link></main>;
  return <main className="login-card"><Link href="/">{t("← Shelfie Street")}</Link><h1>{t("New password")}</h1>
    {params.error && <p className="form-error" role="alert">{t(params.error)}</p>}
    <form action={setNewPassword} className="form-stack">
      {next && <input type="hidden" name="next" value={next} />}
      <label htmlFor="new-password">{t("New password")}</label><input id="new-password" name="password" type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" required />
      <label htmlFor="confirm-password">{t("Confirm password")}</label><input id="confirm-password" name="confirmPassword" type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" required />
      <button type="submit" className="primary-button">{t("Save password")}</button>
    </form>
  </main>;
}
