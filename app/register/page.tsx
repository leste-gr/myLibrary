import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath, MIN_PASSWORD_LENGTH } from "@/lib/email-auth";
import { registerWithEmail } from "./actions";

export const dynamic = "force-dynamic";
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect(next ?? "/login");
  return <main className="login-card">
    <Link href="/">← myLibrary</Link><p className="eyebrow">MYLIBRARY</p>
    <h1>Εγγραφή με email</h1>
    <p>Χρησιμοποίησε τη δική σου διεύθυνση email, όπως Yahoo, Outlook ή οποιονδήποτε άλλο πάροχο.</p>
    {params.error && <p className="form-error" role="alert">{params.error}</p>}
    <form action={registerWithEmail} className="form-stack">
      {next && <input type="hidden" name="next" value={next} />}
      <label htmlFor="register-email">Email</label><input id="register-email" name="email" type="email" maxLength={254} autoComplete="email" required />
      <label htmlFor="register-password">Κωδικός</label><input id="register-password" name="password" type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" aria-describedby="password-hint" required />
      <p id="password-hint" className="privacy-note">Τουλάχιστον 8 χαρακτήρες.</p>
      <label htmlFor="register-confirm">Επιβεβαίωση κωδικού</label><input id="register-confirm" name="confirmPassword" type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" required />
      <label className="terms-check"><input name="acceptTerms" type="checkbox" value="yes" required /><span>Αποδέχομαι τους <Link href="/terms" target="_blank" rel="noopener noreferrer">όρους χρήσης</Link> και έχω διαβάσει την <Link href="/privacy" target="_blank" rel="noopener noreferrer">πολιτική απορρήτου</Link>.</span></label>
      <button type="submit" className="primary-button">Δημιουργία λογαριασμού</button>
    </form>
    <p className="privacy-note">Θα σου στείλουμε σύνδεσμο επιβεβαίωσης. Άνοιξέ τον στον ίδιο browser που χρησιμοποίησες για την εγγραφή.</p>
    <p>Έχεις ήδη λογαριασμό; <Link href={emailAuthPath("/login", next)}>Σύνδεση</Link></p>
  </main>;
}
