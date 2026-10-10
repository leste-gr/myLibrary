"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { CatalogueBook, PublicCollection } from "@/lib/types";

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("el")
    .replace(/ς/g, "σ");

export function Catalogue({ initialBooks, collection, canEdit = false, viewerCollectionSlug = null }: {
  initialBooks: CatalogueBook[];
  collection: PublicCollection;
  canEdit?: boolean;
  viewerCollectionSlug?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState("catalogue");
  const [limit, setLimit] = useState(32);
  const [selected, setSelected] = useState<CatalogueBook | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeFilters = [
    { label: "Αναζήτηση", value: query, clear: () => setQuery("") },
    { label: "Κατηγορία", value: category, clear: () => setCategory("") },
    { label: "Συγγραφέας", value: author, clear: () => setAuthor("") },
    { label: "Γλώσσα", value: language, clear: () => setLanguage("") },
  ].filter((filter) => filter.value);

  const categories = useMemo(() => [...new Set(initialBooks.map((book) => book.category))].sort(), [initialBooks]);
  const authors = useMemo(() => [...new Set(initialBooks.map((book) => book.author))].sort(), [initialBooks]);
  const languages = useMemo(() => [...new Set(initialBooks.map((book) => book.language))].sort(), [initialBooks]);
  const filteredBooks = useMemo(() => {
    const normalized = normalize(query.trim());
    const isbnQuery = query.replace(/[^0-9X]/gi, "");
    const isIsbnQuery = isbnQuery.length >= 9 && /^[0-9X\s-]+$/i.test(query);
    const result = initialBooks.filter((book) => {
      const searchable = normalize([book.title, book.author, book.series, book.category, book.id, book.isbn13].join(" "));
      return (!category || book.category === category)
        && (!author || book.author === author)
        && (!language || book.language === language)
        && (searchable.includes(normalized) || (isIsbnQuery && book.isbn13?.includes(isbnQuery)));
    });
    if (sort === "title") result.sort((a, b) => a.title.localeCompare(b.title, "el"));
    if (sort === "author") result.sort((a, b) => a.author.localeCompare(b.author, "el"));
    return result;
  }, [initialBooks, query, category, author, language, sort]);

  function openBook(book: CatalogueBook) {
    setSelected(book);
    requestAnimationFrame(() => dialogRef.current?.showModal());
  }

  function reset() {
    setQuery("");
    setCategory("");
    setAuthor("");
    setLanguage("");
    setSort("catalogue");
    setLimit(32);
  }

  return (
    <div className="catalogue-shell">
      <a className="skip" href="#catalogue">Μετάβαση στα βιβλία</a>
      <header className="masthead">
        <div className="brand"><span className="monogram" aria-hidden="true">Β.</span><span>{collection.name}<small>ΔΗΜΟΣΙΑ ΣΥΛΛΟΓΗ</small></span></div>
        <nav className="site-nav"><Link href="/">Όλες οι συλλογές</Link>{canEdit ? <><Link className="button-link" href={`/shelfies?collection=${collection.slug}`}>+ Εισαγωγή shelfie</Link><span className="edit-mode">Επεξεργασία ενεργή</span></> : viewerCollectionSlug ? <Link href={`/collections/${viewerCollectionSlug}`}>Η συλλογή μου</Link> : <Link href="/login">Σύνδεση</Link>}</nav>
      </header>
      <main>
        <section className="intro">
          <div><p className="eyebrow">Ο ΚΑΤΑΛΟΓΟΣ</p><h1>{collection.name}</h1><p className="intro-copy">{collection.description ?? "Μια συλλογή, πολλοί κόσμοι."}</p></div>
          <div className="collection-stats"><div><strong>{initialBooks.length}</strong><span>βιβλία</span></div><div><strong>{authors.length}</strong><span>συγγραφείς</span></div><div><strong>{categories.length}</strong><span>κατηγορίες</span></div></div>
        </section>
        <div className="catalogue-search" role="search">
          <label htmlFor="book-search">Αναζήτηση στη συλλογή</label>
          <div className="searchbar">
            <input id="book-search" ref={searchRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(32); }} placeholder="Τίτλος, συγγραφέας, ISBN ή σειρά…" />
            {query && <button className="clear-search" type="button" aria-label="Καθαρισμός αναζήτησης" onClick={() => { setQuery(""); setLimit(32); searchRef.current?.focus(); }}>×</button>}
          </div>
        </div>
        <div className="catalogue-layout">
          <aside aria-label="Φίλτρα βιβλίων">
            <button className="filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="catalogue-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Φίλτρα{[category, author, language].filter(Boolean).length > 0 && ` (${[category, author, language].filter(Boolean).length})`}<span aria-hidden="true">{filtersOpen ? "−" : "+"}</span></button>
            <div id="catalogue-filters" className={`filter-body${filtersOpen ? " is-open" : ""}`}><div className="filter-heading"><h2>Φίλτρα</h2><button type="button" onClick={reset} disabled={!activeFilters.length && sort === "catalogue"}>Καθαρισμός</button></div><div className="select-filters" onChange={() => setLimit(32)}>
              <label htmlFor="category">Κατηγορία</label><select id="category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Όλες</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
              <label htmlFor="author">Συγγραφέας</label><select id="author" value={author} onChange={(event) => setAuthor(event.target.value)}><option value="">Όλοι</option>{authors.map((value) => <option key={value}>{value}</option>)}</select>
              <label htmlFor="language">Γλώσσα</label><select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">Όλες</option>{languages.map((value) => <option key={value}>{value}</option>)}</select>
            </div></div>
          </aside>
          <section id="catalogue" tabIndex={-1} aria-label="Βιβλία συλλογής">
            <div className="catalogue-toolbar"><div><h2>{category || "Όλα τα βιβλία"}</h2><p role="status" aria-live="polite" aria-atomic="true">{filteredBooks.length} από {initialBooks.length} βιβλία</p></div><div className="sort-wrap"><label htmlFor="sort">Ταξινόμηση</label><select id="sort" value={sort} onChange={(event) => { setSort(event.target.value); setLimit(32); }}><option value="catalogue">Σειρά καταλόγου</option><option value="title">Τίτλος Α–Ω</option><option value="author">Συγγραφέας Α–Ω</option></select></div></div>
            {activeFilters.length > 0 && <div className="active-filters" aria-label="Ενεργά φίλτρα">{activeFilters.map((filter) => <button key={filter.label} className="filter-chip" type="button" aria-label={`Αφαίρεση: ${filter.label} — ${filter.value}`} onClick={() => { filter.clear(); setLimit(32); }}>{filter.label}: {filter.value}<span aria-hidden="true"> ×</span></button>)}</div>}
            <div className="book-grid">
              {filteredBooks.slice(0, limit).map((book) => <article className="book-card-shell" key={book.id}><button type="button" className="book-card" onClick={() => openBook(book)}>
                <div className="cover-wrap">{book.cover ? <img src={book.cover} alt={"Εξώφυλλο: " + book.title} loading="lazy" /> : <div className="missing-cover"><span>Το εξώφυλλο δεν είναι διαθέσιμο</span></div>}</div>
                <h3>{book.title}</h3><p className="book-author">{book.author}</p>{book.series && <p className="book-series">{book.series}</p>}{book.isbn13 && <p className="book-isbn">{book.isbn13}</p>}
              </button>{canEdit && <Link className="edit-book-link" href={`/collections/${collection.slug}/books/${book.id}`}>Επεξεργασία ISBN και έκδοσης</Link>}</article>)}
            </div>
            {!filteredBooks.length && <div id="empty"><h3>{initialBooks.length ? "Δεν βρέθηκε κάποιο βιβλίο." : "Η συλλογή δεν έχει ακόμη βιβλία."}</h3>{initialBooks.length > 0 && <><p>Δοκίμασε άλλη αναζήτηση ή αφαίρεσε κάποιο φίλτρο.</p><button type="button" onClick={reset}>Εμφάνιση όλων</button></>}</div>}
            {filteredBooks.length > 0 && <div className="load-more"><p role="status">Εμφανίζονται {Math.min(limit, filteredBooks.length)} από {filteredBooks.length} βιβλία</p>{filteredBooks.length > limit && <button type="button" onClick={() => setLimit((value) => value + 32)}>Εμφάνιση {Math.min(32, filteredBooks.length - limit)} ακόμη βιβλίων</button>}</div>}
          </section>
        </div>
      </main>
      <footer><span>{collection.name}</span><p>Κάθε εγγραφή αντιστοιχεί σε έναν φυσικό τόμο της συλλογής.</p></footer>
      <dialog ref={dialogRef} aria-labelledby="book-detail-title" onClose={() => setSelected(null)} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close(); } }}>
        <button className="close-dialog" aria-label="Κλείσιμο" onClick={() => { dialogRef.current?.close(); setSelected(null); }}>×</button>
        {selected && <div className="detail-layout"><div className="detail-art"><div className="cover-wrap">{selected.cover ? <img src={selected.cover} alt={"Εξώφυλλο: " + selected.title} /> : <div className="missing-cover"><span>Δεν υπάρχει εξώφυλλο</span></div>}</div></div><div className="detail-copy"><p className="eyebrow">ΑΠΟ ΤΗ ΣΥΛΛΟΓΗ</p><h2 id="book-detail-title">{selected.title}</h2><p className="detail-author">{selected.author}</p><dl>
          {selected.category && <><dt>Κατηγορία</dt><dd>{selected.category}</dd></>}
          {selected.language && <><dt>Γλώσσα</dt><dd>{selected.language}</dd></>}
          {selected.publisher && <><dt>Εκδότης</dt><dd>{selected.publisher}</dd></>}
          {selected.isbn13 && <><dt>ISBN-13</dt><dd>{selected.isbn13}</dd></>}
          <dt>Κωδικός</dt><dd>{selected.id}</dd>
        </dl></div></div>}
      </dialog>
    </div>
  );
}
