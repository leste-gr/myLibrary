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
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const configured = isSupabaseConfigured();
  if (configured) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims) {
      if (next) redirect(next);
      const { data: collection } = await supabase.from("collections").select("slug").eq("owner_id", data.claims.sub).order("created_at", { ascending: true }).limit(1).maybeSingle();
      redirect(collection ? `/collections/${collection.slug}` : "/");
    }
  }
  const { error } = params;

  return <main className="login-card">
    <Link href="/">← Όλες οι συλλογές</Link>
    <p className="eyebrow">MYLIBRARY</p>
    <h1>Σύνδεση ή εγγραφή</h1>
    {!configured ? <div className="form-error">Το Supabase δεν έχει συνδεθεί ακόμη. Πρόσθεσε τις μεταβλητές περιβάλλοντος για να ενεργοποιήσεις τη διαχείριση.</div> :
      <>
      {error && <p className="form-error" role="alert">{error}</p>}
      <form action={signInWithGoogle} className="form-stack google-sign-in">
        {next && <input type="hidden" name="next" value={next} />}
        <button className="primary-button" type="submit">Συνέχεια με Google</button>
        <p className="privacy-note">Την πρώτη φορά δημιουργείται ο λογαριασμός σου. Αν έχεις ήδη λογαριασμό, συνδέεσαι στη βιβλιοθήκη σου.</p>
      </form>
      {params.notice === "check-email" && <div className="auth-notice" role="status"><p>Αν η διεύθυνση μπορεί να εγγραφεί, θα λάβεις email επιβεβαίωσης. Έλεγξε τα ανεπιθύμητα και άνοιξε τον σύνδεσμο στον ίδιο browser. Αν έχεις ήδη λογαριασμό, συνδέσου ή επανάφερε τον κωδικό σου.</p></div>}
      <section className="email-sign-in" aria-labelledby="email-login-title"><h2 id="email-login-title">Σύνδεση με email</h2>
      <form action={signIn} className="form-stack">
        {next && <input type="hidden" name="next" value={next} />}
        <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">Κωδικός</label><input id="password" name="password" type="password" autoComplete="current-password" required />
        <button className="primary-button" type="submit">Σύνδεση</button>
      </form>
      <p><Link href={emailAuthPath("/forgot-password", next)}>Ξέχασες τον κωδικό;</Link></p>
      <p>Δεν έχεις λογαριασμό; <Link href={emailAuthPath("/register", next)}>Εγγραφή με email</Link></p>
      <details><summary>Δεν έλαβες email επιβεβαίωσης;</summary>
        <form action={resendConfirmation} className="form-stack">
          {next && <input type="hidden" name="next" value={next} />}
          <label htmlFor="confirmation-email">Email</label><input id="confirmation-email" name="email" type="email" autoComplete="email" maxLength={254} required />
          <button type="submit" className="secondary-button">Νέα αποστολή επιβεβαίωσης</button>
        </form>
      </details>
      </section></>}
  </main>;
}
