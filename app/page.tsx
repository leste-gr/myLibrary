import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { getPublicCollections } from "@/lib/catalogue";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ deleted?: string; view?: string }> }) {
  const t = await getTranslations();
  const { deleted, view } = await searchParams;
  const mine = view === "mine";
  let collectionIds: string[] | undefined;
  if (mine) {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=" + encodeURIComponent("/?view=mine"));
    const { data, error } = await supabase.from("collections").select("id").eq("owner_id", user.id);
    if (error) throw new Error("Unable to load your collections.");
    collectionIds = (data ?? []).map(collection => collection.id);
  }
  const collections = await getPublicCollections(collectionIds);
  return <div className="directory-shell">
    {deleted === "1" && <div className="global-notice" role="status">{t("Collection deleted.")}</div>}
    <header className="masthead">
      <div className="brand"><span className="monogram" aria-hidden="true">Β.</span><span>myLibrary<small>{t("PUBLIC COLLECTIONS")}</small></span></div>
      <nav className="site-nav"><Link href="/?view=mine">{t("My collections")}</Link></nav>
    </header>
    <main className="directory-main">
      <section className="directory-intro"><p className="eyebrow">{t("MYLIBRARY")}</p><h1>{t(mine ? "My collections" : "Libraries worth exploring.")}</h1><p>{t(mine ? "Your books, across all your collections." : "Discover public collections from the community.")}</p></section>
      <nav className="collection-tabs" aria-label={t("Browse collections")}>
        <Link href="/" aria-current={!mine ? "page" : undefined}>{t("All collections")}</Link>
        <Link href="/?view=mine" aria-current={mine ? "page" : undefined}>{t("My collections")}</Link>
      </nav>
      {mine && <p><Link className="button-link" href="/shelfies">{t("+ Import shelf photo")}</Link></p>}
      <section aria-labelledby="collections-title">
        <div className="directory-heading"><h2 id="collections-title">{t(mine ? "My collections" : "All collections")}</h2><span>{collections.length}</span></div>
        <div className="collection-grid">{collections.map((collection) =>
          <Link className="collection-card" href={`/collections/${collection.slug}`} key={collection.id}>
            <p className="eyebrow">{t("PUBLIC COLLECTION")}</p>
            <h2>{collection.name}</h2>
            {collection.description && <p>{collection.description}</p>}
            <dl><div><dt>{t("Books")}</dt><dd>{collection.bookCount}</dd></div><div><dt>{t("Authors")}</dt><dd>{collection.authorCount}</dd></div></dl>
            <span className="collection-link">{t("Open collection →")}</span>
          </Link>
        )}</div>
        {!collections.length && <p className="empty-admin">{t(mine ? "You have no collections yet. Import some books to create your first collection." : "There are no public collections yet.")}</p>}
      </section>
    </main>
  </div>;
}
