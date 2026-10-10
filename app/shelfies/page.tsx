import Link from "next/link";
import { redirect } from "next/navigation";
import { ManualGenaiImportForm } from "@/components/manual-genai-import-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ShelfiePage({ searchParams }: { searchParams: Promise<{ collection?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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

  return <main className="shelfie-shell">
    <Link href={requestedSlug ? `/collections/${requestedSlug}` : "/"}>← Επιστροφή</Link>
    <p className="eyebrow">ΝΕΑ ΠΗΓΗ ΒΙΒΛΙΩΝ</p>
    <h1>Εισαγωγή από shelfie</h1>
    <p className="shelfie-lead">Χρησιμοποίησε το GenAI chat της επιλογής σου για την ανάγνωση της φωτογραφίας και ανέβασε χειροκίνητα μόνο το παραγόμενο JSON.</p>
    <ManualGenaiImportForm userId={user.id} collections={ordered} />
    <p className="privacy-note">Η φωτογραφία δεν αποστέλλεται ποτέ στο myLibrary. Ισχύουν οι όροι και η πολιτική απορρήτου του GenAI chat που επιλέγεις.</p>
  </main>;
}
