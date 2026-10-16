import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath } from "@/lib/email-auth";
import { requestPasswordReset } from "./actions";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string; next?: string }> }) {
  const t = await getTranslations();
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  return <main className="login-card"><Link href={emailAuthPath("/login", next)}>{t("← Log in")}</Link><h1>{t("Forgot your password?")}</h1>
    <p>{t("Enter the email address for your account.")}</p>
    {params.error && <p className="form-error" role="alert">{t(params.error)}</p>}
    {params.sent && <p className="auth-notice" role="status">{t("If an account exists with this email, you will receive reset instructions. Check your spam folder too. Open the link in the same browser.")}</p>}
    <form action={requestPasswordReset} className="form-stack">
      {next && <input type="hidden" name="next" value={next} />}
      <label htmlFor="reset-email">Email</label><input id="reset-email" name="email" type="email" maxLength={254} autoComplete="email" required />
      <button type="submit" className="primary-button">{t("Send instructions")}</button>
    </form>
  </main>;
}
