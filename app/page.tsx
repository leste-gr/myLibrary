import { getTranslations } from "@/lib/i18n/server";
import { Suspense } from "react";
import { CollectionListSkeleton } from "@/components/catalogue-loading";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import Link from "next/link";
import { getCachedPublicCollections, getCachedPublicCollectionPreview } from "@/lib/catalogue-cache";
import { BookCoverImage } from "@/components/book-cover-image";
import { getViewer } from "@/lib/catalogue-viewer";



export default async function HomePage({ searchParams }: { searchParams: Promise<{ deleted?: string; view?: string }> }) {
  const t = await getTranslations();
  const { deleted, view } = await searchParams;
  const mine = view === "mine";
  return <div className="directory-shell">
    {deleted === "1" && <div className="global-notice" role="status">{t("Collection deleted.")}</div>}
    <a className="skip" href="#collections-title">{t("Explore collections")}</a>
    <main className="directory-main">
      <section className="street-hero"><div className="directory-intro"><p className="eyebrow">{t("Welcome to Shelfie Street")}</p><h1>{mine ? t("My collections") : <>{t("Every shelf")}<br /><em>{t("has a story.")}</em></>}</h1><p>{t(mine ? "Your books, across all your collections." : "Find your next read on someone else’s shelf. Make a little room for yours.")}</p>{!mine && <div className="street-actions"><a className="primary-button" href="#collections-title">{t("Explore the shelves ↓")}</a><Link className="secondary-button" href="/shelfies">{t("Add your books")}</Link></div>}</div>{!mine && <div className="street-art" aria-hidden="true"><div><span>{t("Stories")}</span><i /></div><div><span>SHELFIE<br />STREET</span><i /></div><div><span>{t("New worlds")}</span><i /></div></div>}</section>
      <nav className="collection-tabs" aria-label={t("Browse collections")}>
        <Link href="/" aria-current={!mine ? "page" : undefined}>{t("All collections")}</Link>
        <Link href="/?view=mine" aria-current={mine ? "page" : undefined}>{t("My collections")}</Link>
      </nav>
      {mine && <p><Link className="button-link" href="/shelfies">{t("+ Import shelf photo")}</Link></p>}
      <Suspense fallback={<CollectionListSkeleton label={t("Loading collections…")} />}><CollectionDirectory mine={mine} /></Suspense>
    </main>
  </div>;
}

async function CollectionDirectory({ mine }: { mine: boolean }) {
  const t = await getTranslations();
  let collections;
  if (mine) {
    const user = await getViewer();
    if (!user) redirect("/login?next=" + encodeURIComponent("/?view=mine"));
    const supabase = await createSupabaseServerClient();
    const [allCollections, { data, error }] = await Promise.all([
      getCachedPublicCollections(),
      supabase.from("collections").select("id").eq("owner_id", user.id),
    ]);
    if (error) throw new Error("Unable to load your collections.");
    const ownedIds = new Set((data ?? []).map(collection => collection.id));
    collections = allCollections.filter(collection => ownedIds.has(collection.id));
  } else {
    collections = await getCachedPublicCollections();
  }
  return (<section aria-labelledby="collections-title">
        <div className="directory-heading"><h2 id="collections-title">{t(mine ? "My collections" : "Around the shelves")}</h2><span>{collections.length} {t("collections")}</span></div>
        <div className="collection-grid">{collections.map((collection) =>
          <article className="collection-card discovery-card" key={collection.id}>
            <Link className="collection-preview-link" href={`/collections/${collection.slug}`} aria-label={`${t("Explore collection")}: ${collection.name}`}>
              <Suspense fallback={<PreviewShelf />}><CollectionPreview slug={collection.slug} /></Suspense>
            </Link>
            <div className="collection-card-copy">
            <p className="eyebrow">{t("PUBLIC COLLECTION")}</p>
            <h3><Link href={`/collections/${collection.slug}`}>{collection.name}</Link></h3>
            {collection.description && <details className="collection-notes"><summary>{t("About this collection")}</summary><p>{collection.description}</p></details>}
            <div className="collection-card-bottom"><dl><div><dt>{t("Books")}</dt><dd>{collection.bookCount}</dd></div><div><dt>{t("Authors")}</dt><dd>{collection.authorCount}</dd></div></dl>
            <Link className="collection-link" href={`/collections/${collection.slug}`}>{t("Step inside →")}<span className="sr-only"> {collection.name}</span></Link></div>
            </div>
          </article>
        )}</div>
        {!collections.length && <p className="empty-admin">{t(mine ? "You have no collections yet. Import some books to create your first collection." : "There are no public collections yet.")}</p>}
      </section>);
}

function PreviewShelf() {
  return <div className="collection-preview" aria-hidden="true">{[0, 1, 2].map(index => <span className="preview-placeholder" key={index}>Shelfie Street</span>)}</div>;
}

async function CollectionPreview({ slug }: { slug: string }) {
  const books = await getCachedPublicCollectionPreview(slug).catch(() => []);
  if (!books.length) return <PreviewShelf />;
  return <div className="collection-preview" aria-hidden="true">{books.map(book =>
    <BookCoverImage key={book.legacy_id} src={book.cover_url} alt="" fallbackAlt="" width={112} height={164} loading="lazy" decoding="async" />
  )}</div>;
}
