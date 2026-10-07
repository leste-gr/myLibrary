import Link from "next/link";
import { redirect } from "next/navigation";
import { ShelfieUploadForm } from "@/components/shelfie-upload-form";
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
    <h1>Ανέβασε μια shelfie</h1>
    <p className="shelfie-lead">Η φωτογραφία επεξεργάζεται με ανίχνευση ραχών και OCR σε CPU—χωρίς LLM. Διατηρούνται μόνο τα κείμενα και οι βαθμολογίες εμπιστοσύνης.</p>
    <ShelfieUploadForm userId={user.id} collections={ordered} />
    <p className="privacy-note">Η φωτογραφία και τα προσωρινά crops διαγράφονται μόλις ολοκληρωθεί η αρχική εξαγωγή, ή μετά την τελευταία αποτυχημένη προσπάθεια.</p>
  </main>;
}
