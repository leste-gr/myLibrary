"use client";
import { useTranslations } from "@/components/language-provider";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogueBook, PublicCollection } from "@/lib/types";
import { DeleteCollectionButton } from "@/components/delete-collection-button";
import { DeleteBookButton } from "@/components/delete-book-button";

const normalize = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("el")
    .replace(/ς/g, "σ");

export function Catalogue({ initialBooks, collection, canEdit = false, viewerSignedIn = false }: {
  initialBooks: CatalogueBook[];
  collection: PublicCollection;
  canEdit?: boolean;
  viewerSignedIn?: boolean;
}) {
  const t = useTranslations();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState("catalogue");
  const [limit, setLimit] = useState(32);
  const [selected, setSelected] = useState<CatalogueBook | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeFilters = [
    { label: t("Search"), value: query, clear: () => setQuery("") },
    { label: t("Category"), value: category, clear: () => setCategory("") },
    { label: t("Author"), value: author, clear: () => setAuthor("") },
    { label: t("Language"), value: language, clear: () => setLanguage("") },
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

  useEffect(() => {
    if (!("IntersectionObserver" in window)) { setManualLoading(true); return; }
    const sentinel = sentinelRef.current;
    if (!sentinel || limit >= filteredBooks.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        setLimit(value => Math.min(value + 32, filteredBooks.length));
      }
    }, { rootMargin: "400px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [limit, filteredBooks]);

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
      <a className="skip" href="#catalogue">{t("Skip to books")}</a>
      <header className="masthead">
        <div className="brand"><span className="monogram" aria-hidden="true">Β.</span><span>{collection.name}<small>{t("PUBLIC COLLECTION")}</small></span></div>
        <nav className="site-nav"><Link href="/">{t("All collections")}</Link>{canEdit ? <><Link className="button-link" href={`/shelfies?collection=${collection.slug}`}>{t("+ Import shelf photo")}</Link><span className="edit-mode">{t("Editing enabled")}</span></> : viewerSignedIn ? <Link href="/?view=mine">{t("My collections")}</Link> : <Link href="/login">{t("Log in")}</Link>}</nav>
      </header>
      <main>
        <section className="intro">
          <div><p className="eyebrow">{t("THE CATALOGUE")}</p><h1>{collection.name}</h1><p className="intro-copy">{collection.description ?? t("One collection, many worlds.")}</p>{canEdit && <div className="collection-danger"><DeleteCollectionButton collectionId={collection.id} collectionName={collection.name} /></div>}</div>
          <div className="collection-stats"><div><strong>{initialBooks.length}</strong><span>{t("books")}</span></div><div><strong>{authors.length}</strong><span>{t("authors")}</span></div><div><strong>{categories.length}</strong><span>{t("categories")}</span></div></div>
        </section>
        <div className="catalogue-search" role="search">
          <label htmlFor="book-search">{t("Search this collection")}</label>
          <div className="searchbar">
            <input id="book-search" ref={searchRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(32); }} placeholder={t("Title, author, ISBN or series…")} />
            {query && <button className="clear-search" type="button" aria-label={t("Clear search")} onClick={() => { setQuery(""); setLimit(32); searchRef.current?.focus(); }}>×</button>}
          </div>
        </div>
        <div className="catalogue-layout">
          <aside aria-label={t("Book filters")}>
            <button className="filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="catalogue-filters" onClick={() => setFiltersOpen(!filtersOpen)}>{t("Filters")}{[category, author, language].filter(Boolean).length > 0 && ` (${[category, author, language].filter(Boolean).length})`}<span aria-hidden="true">{filtersOpen ? "−" : "+"}</span></button>
            <div id="catalogue-filters" className={`filter-body${filtersOpen ? " is-open" : ""}`}><div className="filter-heading"><h2>{t("Filters")}</h2><button type="button" onClick={reset} disabled={!activeFilters.length && sort === "catalogue"}>{t("Clear")}</button></div><div className="select-filters" onChange={() => setLimit(32)}>
              <label htmlFor="category">{t("Category")}</label><select id="category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{t("All")}</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
              <label htmlFor="author">{t("Author")}</label><select id="author" value={author} onChange={(event) => setAuthor(event.target.value)}><option value="">{t("All")}</option>{authors.map((value) => <option key={value}>{value}</option>)}</select>
              <label htmlFor="language">{t("Language")}</label><select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">{t("All")}</option>{languages.map((value) => <option key={value}>{value}</option>)}</select>
            </div></div>
          </aside>
          <section id="catalogue" tabIndex={-1} aria-label={t("Collection books")}>
            <div className="catalogue-toolbar"><div><h2>{category || t("All books")}</h2><p role="status" aria-live="polite" aria-atomic="true">{filteredBooks.length} {" " + t("of") + " "}{initialBooks.length} {" " + t("books")}</p></div><div className="sort-wrap"><label htmlFor="sort">{t("Sort by")}</label><select id="sort" value={sort} onChange={(event) => { setSort(event.target.value); setLimit(32); }}><option value="catalogue">{t("Catalogue order")}</option><option value="title">{t("Title A–Z")}</option><option value="author">{t("Author A–Z")}</option></select></div></div>
            {activeFilters.length > 0 && <div className="active-filters" aria-label={t("Active filters")}>{activeFilters.map((filter) => <button key={filter.label} className="filter-chip" type="button" aria-label={t("Remove: {0} — {1}", [filter.label, filter.value])} onClick={() => { filter.clear(); setLimit(32); }}>{filter.label}: {filter.value}<span aria-hidden="true"> ×</span></button>)}</div>}
            <div className="book-grid">
              {filteredBooks.slice(0, limit).map((book) => <article className="book-card-shell" key={book.id}><button type="button" className="book-card" onClick={() => openBook(book)}>
                <div className="cover-wrap">{book.cover ? <img src={book.cover} alt={t("Cover: ") + book.title} loading="lazy" /> : <div className="missing-cover"><span>{t("Cover unavailable")}</span></div>}</div>
                <h3>{book.title}</h3><p className="book-author">{book.author}</p>{book.series && <p className="book-series">{book.series}</p>}{book.isbn13 && <p className="book-isbn">{book.isbn13}</p>}
              </button>{canEdit && <div className="book-owner-actions"><Link className="edit-book-link" href={`/collections/${collection.slug}/books/${book.id}`}>{t("Edit ISBN and edition")}</Link><DeleteBookButton collectionId={collection.id} collectionSlug={collection.slug} legacyId={book.id} title={book.title} /></div>}</article>)}
            </div>
            {!filteredBooks.length && <div id="empty"><h3>{initialBooks.length ? t("No books found.") : t("This collection has no books yet.")}</h3>{initialBooks.length > 0 && <><p>{t("Try another search or remove a filter.")}</p><button type="button" onClick={reset}>{t("Show all")}</button></>}</div>}
            {filteredBooks.length > 0 && <div className="load-more" ref={sentinelRef}><p role="status" aria-live="polite">{t("Showing") + " "}{Math.min(limit, filteredBooks.length)} {" " + t("of") + " "}{filteredBooks.length} {" " + t("books")}</p>{filteredBooks.length > limit && !manualLoading && <p className="scroll-hint">{t("Scroll to discover more books")}</p>}{filteredBooks.length > limit && manualLoading && <button type="button" onClick={() => setLimit((value) => value + 32)}>{t("Show") + " "}{Math.min(32, filteredBooks.length - limit)} {" " + t("more books")}</button>}</div>}
          </section>
        </div>
      </main>
      <footer><span>{collection.name}</span><p>{t("Each record represents a physical volume in the collection.")}</p></footer>
      <dialog ref={dialogRef} aria-labelledby="book-detail-title" onClose={() => setSelected(null)} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close(); } }}>
        <button className="close-dialog" aria-label={t("Close")} onClick={() => { dialogRef.current?.close(); setSelected(null); }}>×</button>
        {selected && <div className="detail-layout"><div className="detail-art"><div className="cover-wrap">{selected.cover ? <img src={selected.cover} alt={t("Cover: ") + selected.title} /> : <div className="missing-cover"><span>{t("No cover available")}</span></div>}</div></div><div className="detail-copy"><p className="eyebrow">{t("FROM THE COLLECTION")}</p><h2 id="book-detail-title">{selected.title}</h2><p className="detail-author">{selected.author}</p><dl>
          {selected.category && <><dt>{t("Category")}</dt><dd>{selected.category}</dd></>}
          {selected.language && <><dt>{t("Language")}</dt><dd>{selected.language}</dd></>}
          {selected.publisher && <><dt>{t("Publisher")}</dt><dd>{selected.publisher}</dd></>}
          {selected.isbn13 && <><dt>ISBN-13</dt><dd>{selected.isbn13}</dd></>}
          <dt>{t("Password")}</dt><dd>{selected.id}</dd>
        </dl></div></div>}
      </dialog>
    </div>
  );
}
