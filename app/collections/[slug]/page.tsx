import { notFound } from "next/navigation";
import { Catalogue } from "@/components/catalogue";
import { getPublicCatalogue, getPublicCollection } from "@/lib/catalogue";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const revalidate = 60;

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ shelfie?: string; chatgpt?: string; count?: string }> }) {
  const { slug } = await params;
  const { shelfie, chatgpt, count } = await searchParams;
  const [collection, books] = await Promise.all([
    getPublicCollection(slug),
    getPublicCatalogue(slug),
  ]);
  if (!collection) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  let viewerCollectionSlug: string | null = null;
  let canEdit = false;
  if (user) {
    const { data: viewerCollections } = await supabase
      .from("collections")
      .select("slug")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true });
    viewerCollectionSlug = viewerCollections?.[0]?.slug ?? null;
    canEdit = viewerCollections?.some((item) => item.slug === collection.slug) ?? false;
  }
  return <>
    {shelfie === "queued" && <div className="global-notice" role="status">Η shelfie ανέβηκε και περιμένει επεξεργασία. Η φωτογραφία θα διαγραφεί μόλις εξαχθούν τα δεδομένα των βιβλίων.</div>}
    {chatgpt === "imported" && <div className="global-notice" role="status">Η εισαγωγή ολοκληρώθηκε: προστέθηκαν {Number(count) || 0} βιβλία από το ChatGPT.</div>}
    <Catalogue initialBooks={books} collection={collection} canEdit={canEdit} viewerCollectionSlug={viewerCollectionSlug} />
  </>;
}
