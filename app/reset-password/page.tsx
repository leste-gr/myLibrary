import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";
import { emailAuthPath, MIN_PASSWORD_LENGTH } from "@/lib/email-auth";
import { setNewPassword } from "./actions";

export const dynamic = "force-dynamic";
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string; updated?: string }> }) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(emailAuthPath("/forgot-password", next, { error: "Άνοιξε έναν έγκυρο σύνδεσμο επαναφοράς από το email σου." }));
  if (params.updated === "1") return <main className="login-card"><h1>Ο κωδικός άλλαξε</h1><p role="status">Ο νέος κωδικός αποθηκεύτηκε.</p><Link className="button-link" href={next ?? "/login"}>Συνέχεια</Link></main>;
  return <main className="login-card"><Link href="/">← myLibrary</Link><h1>Νέος κωδικός</h1>
    {params.error && <p className="form-error" role="alert">{params.error}</p>}
    <form action={setNewPassword} className="form-stack">
      {next && <input type="hidden" name="next" value={next} />}
      <label htmlFor="new-password">Νέος κωδικός</label><input id="new-password" name="password" type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" required />
      <label htmlFor="confirm-password">Επιβεβαίωση κωδικού</label><input id="confirm-password" name="confirmPassword" type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={128} autoComplete="new-password" required />
      <button type="submit" className="primary-button">Αποθήκευση κωδικού</button>
    </form>
  </main>;
}
