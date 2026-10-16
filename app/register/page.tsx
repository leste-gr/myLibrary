import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath, MIN_PASSWORD_LENGTH } from "@/lib/email-auth";
import { registerWithEmail } from "./actions";

export const dynamic = "force-dynamic";
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(next ?? "/login");
  return <main className="login-card">
    <Link href="/">{t("← myLibrary")}</Link><p className="eyebrow">{t("MYLIBRARY")}</p>
    <h1>{t("Register with email")}</h1>
    <p>{t("Use your own email address, including Yahoo, Outlook, or any other provider.")}</p>
    {params.error && <p className="form-error" role="alert">{t(params.error)}</p>}
    <form action={registerWithEmail} className="form-stack">
      {next && <input type="hidden" name="next" value={next} />}
      <label htmlFor="register-email">Email</label><input id="register-email" name="email" type="email" maxLength={254} autoComplete="email" required />
      <label htmlFor="register-password">{t("Password")}</label><input id="register-password" name="password" type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" aria-describedby="password-hint" required />
      <p id="password-hint" className="privacy-note">{t("At least 8 characters.")}</p>
      <label htmlFor="register-confirm">{t("Confirm password")}</label><input id="register-confirm" name="confirmPassword" type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" required />
      <label className="terms-check"><input name="acceptTerms" type="checkbox" value="yes" required /><span>{t("I accept the") + " "}<Link href="/terms" target="_blank" rel="noopener noreferrer">{t("terms of service")}</Link> {" " + t("and have read the") + " "}<Link href="/privacy" target="_blank" rel="noopener noreferrer">{t("privacy policy")}</Link>{t(".")}</span></label>
      <button type="submit" className="primary-button">{t("Create account")}</button>
    </form>
    <p className="privacy-note">{t("We will email you a confirmation link. Open it in the same browser you used to register.")}</p>
    <p>{t("Already have an account?") + " "}<Link href={emailAuthPath("/login", next)}>{t("Log in")}</Link></p>
  </main>;
}
