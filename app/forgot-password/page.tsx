import Link from "next/link";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath } from "@/lib/email-auth";
import { requestPasswordReset } from "./actions";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string; next?: string }> }) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  return <main className="login-card"><Link href={emailAuthPath("/login", next)}>← Σύνδεση</Link><h1>Ξέχασες τον κωδικό;</h1>
    <p>Συμπλήρωσε το email του λογαριασμού σου.</p>
    {params.error && <p className="form-error" role="alert">{params.error}</p>}
    {params.sent && <p className="auth-notice" role="status">Αν υπάρχει λογαριασμός με αυτό το email, θα λάβεις οδηγίες επαναφοράς. Έλεγξε και τα ανεπιθύμητα. Άνοιξε τον σύνδεσμο στον ίδιο browser.</p>}
    <form action={requestPasswordReset} className="form-stack">
      {next && <input type="hidden" name="next" value={next} />}
      <label htmlFor="reset-email">Email</label><input id="reset-email" name="email" type="email" maxLength={254} autoComplete="email" required />
      <button type="submit" className="primary-button">Αποστολή οδηγιών</button>
    </form>
  </main>;
}
