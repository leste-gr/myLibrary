import Link from "next/link";
import { redirect } from "next/navigation";
import { ChatGptImportFlow } from "@/components/chatgpt-import-flow";
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
    <h1>Shelfie μέσω ChatGPT</h1>
    <p className="shelfie-lead">Χρησιμοποίησε το δικό σου ChatGPT για να διαβάσει τη φωτογραφία. Το myLibrary λαμβάνει μόνο τα δομημένα δεδομένα βιβλίων—ποτέ την εικόνα.</p>
    <ChatGptImportFlow collections={ordered} />
    <p className="privacy-note">Ο προσωρινός κωδικός λήγει σε 30 λεπτά και χρησιμοποιείται μόνο μία φορά.</p>
  </main>;
}
