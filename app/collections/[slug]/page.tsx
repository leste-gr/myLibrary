import { notFound } from "next/navigation";
import { Catalogue } from "@/components/catalogue";
import { getPublicCatalogue, getPublicCollection } from "@/lib/catalogue";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const revalidate = 60;

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [collection, books] = await Promise.all([
    getPublicCollection(slug),
    getPublicCatalogue(slug),
  ]);
  if (!collection) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  let viewerCollectionSlug: string | null = null;
  if (user) {
    const { data: viewerCollection } = await supabase
      .from("collections")
      .select("slug")
      .eq("owner_id", user.id)
      .single();
    viewerCollectionSlug = viewerCollection?.slug ?? null;
  }
  return <Catalogue
    initialBooks={books}
    collection={collection}
    canEdit={viewerCollectionSlug === collection.slug}
    viewerCollectionSlug={viewerCollectionSlug}
  />;
}
