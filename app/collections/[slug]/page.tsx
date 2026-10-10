import { notFound } from "next/navigation";
import { Catalogue } from "@/components/catalogue";
import { getPublicCatalogue, getPublicCollection } from "@/lib/catalogue";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const revalidate = 60;

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ imported?: string }> }) {
  const { slug } = await params;
  const { imported } = await searchParams;
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
    {imported && <div className="global-notice" role="status">Εισήχθησαν {imported} βιβλία από το αρχείο JSON.</div>}
    <Catalogue initialBooks={books} collection={collection} canEdit={canEdit} viewerCollectionSlug={viewerCollectionSlug} />
  </>;
}
