import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { emailAuthPath } from "@/lib/email-auth";
import { resendConfirmation } from "@/app/register/actions";
import { signIn, signInWithGoogle } from "./actions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; notice?: string }> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const configured = isSupabaseConfigured();
  if (configured) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims) {
      if (next) redirect(next);
      redirect("/?view=mine");
    }
  }
  const { error } = params;

  return <main className="login-card">
    <Link href="/">{t("← All collections")}</Link>
    <p className="eyebrow">{t("MYLIBRARY")}</p>
    <h1>{t("Log in or register")}</h1>
    {!configured ? <div className="form-error">{t("Account management is not available yet. Please try again later.")}</div> :
      <>
      {error && <p className="form-error" role="alert">{t(error)}</p>}
      <form action={signInWithGoogle} className="form-stack google-sign-in">
        {next && <input type="hidden" name="next" value={next} />}
        <button className="primary-button" type="submit">{t("Continue with Google")}</button>
        <p className="privacy-note">{t("Your first sign-in creates an account. If you already have an account, you will sign in to your library.")}</p>
      </form>
      {params.notice === "check-email" && <div className="auth-notice" role="status"><p>{t("If this address can be registered, you will receive a confirmation email. Check your spam folder and open the link in the same browser. If you already have an account, log in or reset your password.")}</p></div>}
      <section className="email-sign-in" aria-labelledby="email-login-title"><h2 id="email-login-title">{t("Log in with email")}</h2>
      <form action={signIn} className="form-stack">
        {next && <input type="hidden" name="next" value={next} />}
        <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">{t("Password")}</label><input id="password" name="password" type="password" autoComplete="current-password" required />
        <button className="primary-button" type="submit">{t("Log in")}</button>
      </form>
      <p><Link href={emailAuthPath("/forgot-password", next)}>{t("Forgot your password?")}</Link></p>
      <p>{t("Don't have an account?") + " "}<Link href={emailAuthPath("/register", next)}>{t("Register with email")}</Link></p>
      <details><summary>{t("Didn't receive a confirmation email?")}</summary>
        <form action={resendConfirmation} className="form-stack">
          {next && <input type="hidden" name="next" value={next} />}
          <label htmlFor="confirmation-email">Email</label><input id="confirmation-email" name="email" type="email" autoComplete="email" maxLength={254} required />
          <button type="submit" className="secondary-button">{t("Resend confirmation")}</button>
        </form>
      </details>
      </section></>}
  </main>;
}
