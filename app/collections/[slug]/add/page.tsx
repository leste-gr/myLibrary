import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { AddIsbnBook } from "@/components/add-isbn-book";

export default async function AddBookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/collections/${slug}/add`)}`);
  const { data: collection, error } = await supabase.from("collections").select("id,name,slug")
    .eq("slug", slug).eq("owner_id", user.id).maybeSingle();
  if (error || !collection) notFound();
  const t = await getTranslations();
  return <main className="shelfie-shell isbn-add-shell">
    <Link href={`/collections/${collection.slug}`}>{t("← Back to collection")}</Link>
    <p className="eyebrow">{collection.name}</p>
    <h1>{t("Add a book by ISBN")}</h1>
    <p className="shelfie-lead">{t("Scan the barcode on the back of your book, review the details, and add it to your collection.")}</p>
    <AddIsbnBook slug={collection.slug} />
  </main>;
}
