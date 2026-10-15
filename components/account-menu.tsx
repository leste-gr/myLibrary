import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { signOut } from "@/app/auth/actions";

export async function AccountMenu() {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <nav className="account-menu" aria-label="Λογαριασμός">
    {user ? <>
      <span className="account-email">{user.email}</span>
      <Link href="/login">Η βιβλιοθήκη μου</Link>
      <Link href="/shelfies/connections">Συνδεδεμένες εφαρμογές</Link>
      <form action={signOut}><button type="submit" className="secondary-button">Αποσύνδεση</button></form>
    </> : <Link href="/login">Σύνδεση / Εγγραφή</Link>}
  </nav>;
}
