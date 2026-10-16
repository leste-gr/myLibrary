import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";
import { Catalogue } from "@/components/catalogue";
import { IsbnMatchRetry } from "@/components/isbn-match-retry";
import { getPublicCatalogue, getPublicCollection } from "@/lib/catalogue";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const revalidate = 60;

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ imported?: string; matched?: string; unresolved?: string; retryable?: string; matching?: string; matchImport?: string; bookDeleted?: string }> }) {
  const t = await getTranslations();
  const { slug } = await params;
  const { imported, matched, unresolved, retryable, matching, matchImport, bookDeleted } = await searchParams;
  const [collection, books] = await Promise.all([
    getPublicCollection(slug),
    getPublicCatalogue(slug),
  ]);
  if (!collection) notFound();
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  let canEdit = false;
  let unfinishedImport: { id: string; matching_status: string; matching_error: string | null; matching_started_at: string | null } | null = null;
  if (user && supabase) {
    const { data: viewerCollections } = await supabase
      .from("collections")
      .select("slug")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true });
    canEdit = viewerCollections?.some((item) => item.slug === collection.slug) ?? false;
    if (canEdit) {
      const { data: importData } = await supabase
        .from("manual_genai_imports")
        .select("id,matching_status,matching_error,matching_started_at")
        .eq("collection_id", collection.id)
        .in("matching_status", ["pending", "processing", "partial", "failed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      unfinishedImport = importData;
    }
  }
  const matchingIsStale = unfinishedImport?.matching_status === "processing"
    && (!unfinishedImport.matching_started_at || Date.now() - new Date(unfinishedImport.matching_started_at).getTime() > 10 * 60 * 1000);
  return <>
    {bookDeleted && <div className="global-notice" role="status">{t("Book deleted from the collection.")}</div>}
    {imported && <div className="global-notice" role="status">{t("Imported") + " "}{imported} {" " + t("books from the JSON file.")}</div>}
    {matched !== undefined && <div className="global-notice" role="status">{t("ISBN matching found matches for") + " "}{matched} {" " + t("books.") + " "}{unresolved !== "0" && t("{0} have no candidate ISBN.", [unresolved])} {retryable !== "0" && t("{0} need another attempt.", [retryable])}</div>}
    {matching === "retry" && matchImport && canEdit && <IsbnMatchRetry importId={matchImport} collectionSlug={collection.slug} />}
    {matching !== "retry" && unfinishedImport && (["partial", "failed"].includes(unfinishedImport.matching_status) || matchingIsStale) && <IsbnMatchRetry importId={unfinishedImport.id} collectionSlug={collection.slug} />}
    {unfinishedImport?.matching_status === "pending" && <div className="global-notice" role="status">{t("ISBN matching is queued and will start automatically.")}</div>}
    {unfinishedImport?.matching_status === "processing" && !matchingIsStale && <div className="global-notice" role="status">{t("ISBN matching is processing the latest import.")}</div>}
    <Catalogue initialBooks={books} collection={collection} canEdit={canEdit} viewerSignedIn={Boolean(user)} />
  </>;
}
