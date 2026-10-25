import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { Catalogue } from "@/components/catalogue";
import { getCachedPublicCatalogue, getCachedPublicCollection } from "@/lib/catalogue-cache";
import { getOwnedCollectionLoans } from "@/lib/book-loan-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCollectionViewer } from "@/lib/catalogue-viewer";

export const revalidate = 60;

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ imported?: string; bookDeleted?: string }> }) {
  const t = await getTranslations();
  const { slug } = await params;
  const { imported, bookDeleted } = await searchParams;
  const [collection, books, viewer] = await Promise.all([
    getCachedPublicCollection(slug),
    getCachedPublicCatalogue(slug),
    getCollectionViewer(slug),
  ]);
  if (!collection) notFound();
  const loans = viewer.canEdit ? await getOwnedCollectionLoans(await createSupabaseServerClient(),collection.id) : {};
  return <>
    {bookDeleted && <div className="global-notice" role="status">{t("Book deleted from the collection.")}</div>}
    {imported && <div className="global-notice" role="status">{t("Imported") + " "}{imported} {" " + t("books from the JSON file.")}</div>}
    <Catalogue initialLoans={loans} initialBooks={books} collection={collection} canEdit={viewer.canEdit} viewerSignedIn={viewer.signedIn} />
  </>;
}
