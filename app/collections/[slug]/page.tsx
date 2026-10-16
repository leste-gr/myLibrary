import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { Catalogue } from "@/components/catalogue";
import { getPublicCatalogue, getPublicCollection } from "@/lib/catalogue";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const revalidate = 60;

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ imported?: string; bookDeleted?: string }> }) {
  const t = await getTranslations();
  const { slug } = await params;
  const { imported, bookDeleted } = await searchParams;
  const [collection, books] = await Promise.all([
    getPublicCollection(slug),
    getPublicCatalogue(slug),
  ]);
  if (!collection) notFound();
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  let canEdit = false;
  if (user && supabase) {
    const { data: viewerCollections } = await supabase
      .from("collections")
      .select("slug")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true });
    canEdit = viewerCollections?.some((item) => item.slug === collection.slug) ?? false;
  }
  return <>
    {bookDeleted && <div className="global-notice" role="status">{t("Book deleted from the collection.")}</div>}
    {imported && <div className="global-notice" role="status">{t("Imported") + " "}{imported} {" " + t("books from the JSON file.")}</div>}
    <Catalogue initialBooks={books} collection={collection} canEdit={canEdit} viewerSignedIn={Boolean(user)} />
  </>;
}
