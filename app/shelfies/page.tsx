import Link from "next/link";
import { redirect } from "next/navigation";
import { ShelfieReview } from "@/components/shelfie-review";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { assistantConfigured } from "@/lib/assistant-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ShelfiePage({ searchParams }: { searchParams: Promise<{ collection?: string }> }) {
  if (!isSupabaseConfigured()) redirect("/shelfies/try");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/shelfies");

  const { collection: requestedSlug } = await searchParams;
  const { data } = await supabase
    .from("collections")
    .select("id,slug,name")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });
  const collections = data ?? [];
  const ordered = requestedSlug
    ? [...collections].sort((left, right) => Number(right.slug === requestedSlug) - Number(left.slug === requestedSlug))
    : collections;
  const drafts = assistantConfigured() ? await supabase.from("shelfie_import_drafts").select("id,created_at,payload").eq("owner_id", user.id).eq("status", "pending").order("created_at", { ascending: false }).limit(20) : null;

  return <main className="shelfie-shell">
    <Link href={requestedSlug ? `/collections/${requestedSlug}` : "/"}>← Επιστροφή</Link>
    <p className="eyebrow">ΝΕΑ ΠΗΓΗ ΒΙΒΛΙΩΝ</p>
    <h1>Εισαγωγή από shelfie</h1>
    <p className="shelfie-lead">Διάβασε τη φωτογραφία με το δικό σου AI και έλεγξε τα βιβλία πριν τα προσθέσεις.</p>
    <section className="assistant-callout"><h2>Απευθείας από το ChatGPT</h2><p>{assistantConfigured() ? "Σύνδεσε το myLibrary και ζήτησε από το chat να στείλει τα βιβλία για έλεγχο." : "Η απευθείας σύνδεση προετοιμάζεται. Μπορείς ήδη να χρησιμοποιήσεις την επικόλληση απάντησης παρακάτω."}</p><Link href="/shelfies/connect">Πώς λειτουργεί η σύνδεση →</Link></section>
    {drafts?.error && <p className="form-error" role="alert">Δεν ήταν δυνατή η φόρτωση των πρόχειρων εισαγωγών. Δοκίμασε ανανέωση της σελίδας.</p>}
    {Boolean(drafts?.data?.length) && <section className="draft-inbox"><h2>Περιμένουν έλεγχο</h2>{drafts?.data?.map((draft) => <Link key={draft.id} href={`/shelfies/review/${draft.id}`}>Έλεγχος {Array.isArray(draft.payload?.books) ? draft.payload.books.length : ""} βιβλίων · {new Date(draft.created_at).toLocaleDateString("el-GR")}</Link>)}</section>}
    <ShelfieReview userId={user.id} collections={ordered} />
    <p className="privacy-note">Η φωτογραφία δεν αποστέλλεται ποτέ στο myLibrary. Ισχύουν οι όροι και η πολιτική απορρήτου του GenAI chat που επιλέγεις.</p>
  </main>;
}
