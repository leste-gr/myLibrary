import Link from "next/link";
import { getPublicCollections } from "@/lib/catalogue";

export const revalidate = 60;

export default async function HomePage() {
  const collections = await getPublicCollections();
  return <div className="directory-shell">
    <header className="masthead">
      <div className="brand"><span className="monogram" aria-hidden="true">Β.</span><span>myLibrary<small>ΔΗΜΟΣΙΕΣ ΣΥΛΛΟΓΕΣ</small></span></div>
      <nav className="site-nav"><Link href="/admin">Η συλλογή μου</Link></nav>
    </header>
    <main className="directory-main">
      <section className="directory-intro"><p className="eyebrow">MYLIBRARY</p><h1>Βιβλιοθήκες που ανοίγουν.</h1><p>Ανακάλυψε τις δημόσιες συλλογές της κοινότητας.</p></section>
      <section aria-labelledby="collections-title">
        <div className="directory-heading"><h2 id="collections-title">Όλες οι συλλογές</h2><span>{collections.length}</span></div>
        <div className="collection-grid">{collections.map((collection) =>
          <Link className="collection-card" href={`/collections/${collection.slug}`} key={collection.id}>
            <p className="eyebrow">ΔΗΜΟΣΙΑ ΣΥΛΛΟΓΗ</p>
            <h2>{collection.name}</h2>
            {collection.description && <p>{collection.description}</p>}
            <dl><div><dt>Βιβλία</dt><dd>{collection.bookCount}</dd></div><div><dt>Συγγραφείς</dt><dd>{collection.authorCount}</dd></div></dl>
            <span className="collection-link">Άνοιγμα συλλογής →</span>
          </Link>
        )}</div>
        {!collections.length && <p className="empty-admin">Δεν υπάρχουν ακόμη δημόσιες συλλογές.</p>}
      </section>
    </main>
  </div>;
}
