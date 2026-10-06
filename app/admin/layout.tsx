import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: collection } = await supabase
    .from("collections")
    .select("slug,name")
    .eq("owner_id", user.id)
    .single();
  if (!collection) redirect("/");

  return <div className="admin-shell">
    <header className="admin-header">
      <div><p className="eyebrow">OWNER WORKSPACE</p><h1>{collection.name}</h1></div>
      <nav><Link href={`/collections/${collection.slug}`}>Δημόσιος κατάλογος</Link><form action={signOut}><button type="submit" className="secondary-button">Αποσύνδεση</button></form></nav>
    </header>
    {children}
  </div>;
}
