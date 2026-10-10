import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "./actions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeReturnPath } from "@/lib/safe-return-path";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
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
    <h1>Σύνδεση στη συλλογή μου</h1>
    {!configured ? <div className="form-error">Το Supabase δεν έχει συνδεθεί ακόμη. Πρόσθεσε τις μεταβλητές περιβάλλοντος για να ενεργοποιήσεις τη διαχείριση.</div> :
      <form action={signIn} className="form-stack">
        {next && <input type="hidden" name="next" value={next} />}
        {error && <p className="form-error">{error}</p>}
        <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">Κωδικός</label><input id="password" name="password" type="password" autoComplete="current-password" required />
        <button className="primary-button" type="submit">Σύνδεση</button>
      </form>}
  </main>;
}
