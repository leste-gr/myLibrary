"use client";
import { useTranslations } from "@/components/language-provider";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { isReadingStatus, type ReadingStatus } from "@/lib/reading-status";
import { changeBooksReadingStatus } from "@/lib/reading-status-client";
import type { CatalogueBook, PublicCollection } from "@/lib/types";
import { DeleteCollectionButton } from "@/components/delete-collection-button";
import { DeleteBookButton } from "@/components/delete-book-button";
import { BookReadingStatus } from "@/components/reading-status";
import { BookCoverImage } from "@/components/book-cover-image";

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
  const [books, setBooks] = useState(initialBooks);
  useEffect(() => { setBooks(initialBooks); }, [initialBooks]);
  const [readingFilter, setReadingFilter] = useState("");
  const [chosenBooks, setChosenBooks] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<ReadingStatus>("read");
  const [bulkPending, startBulkTransition] = useTransition();
  const [bulkError, setBulkError] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchIndex = useMemo(() => books.map(book => ({ book, searchable: normalize([book.title, book.author, book.series, book.category, book.id, book.isbn13].join(" ")) })), [books]);
  const [category, setCategory] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState("catalogue");
  const [limit, setLimit] = useState(32);
  const [returnBook, setReturnBook] = useState<string | null>(null);
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
    { label: t("Reading status"), value: readingFilter ? (readingFilter === "read" ? t("Read") : readingFilter === "radar" ? t("On my radar") : t("Unread")) : "", clear: () => setReadingFilter("") },
  ].filter((filter) => filter.value);

  const categories = useMemo(() => [...new Set(initialBooks.map((book) => book.category))].sort(), [initialBooks]);
  const authors = useMemo(() => [...new Set(initialBooks.map((book) => book.author))].sort(), [initialBooks]);
  const languages = useMemo(() => [...new Set(initialBooks.map((book) => book.language))].sort(), [initialBooks]);
  const filteredBooks = useMemo(() => {
    const normalized = normalize(deferredQuery.trim());
    const isbnQuery = deferredQuery.replace(/[^0-9X]/gi, "");
    const isIsbnQuery = isbnQuery.length >= 9 && /^[0-9X\s-]+$/i.test(deferredQuery);
    const result = searchIndex.filter(({ book, searchable }) => {
      return (!category || book.category === category)
        && (!author || book.author === author)
        && (!language || book.language === language)
        && (!readingFilter || book.readingStatus === readingFilter)
        && (searchable.includes(normalized) || (isIsbnQuery && book.isbn13?.includes(isbnQuery)));
    }).map(({ book }) => book);
    if (sort === "title") result.sort((a, b) => a.title.localeCompare(b.title, "el"));
    if (sort === "author") result.sort((a, b) => a.author.localeCompare(b.author, "el"));
    return result;
  }, [searchIndex, deferredQuery, category, author, language, readingFilter, sort]);

  useEffect(() => {
    function restoreBook() {
      if (!window.location.hash.startsWith("#book-")) return;
      let id: string;
      try { id = decodeURIComponent(window.location.hash.slice(6)); } catch { return; }
      if (!initialBooks.some(book => book.id === id)) return;
      try {
        const saved = JSON.parse(sessionStorage.getItem(`catalogue-return:${collection.slug}`) ?? "null");
        if (saved?.bookId === id && [saved.query, saved.category, saved.author, saved.language, saved.sort].every(value => typeof value === "string")) {
          setQuery(saved.query); setCategory(saved.category); setAuthor(saved.author);
          setLanguage(saved.language); setSort(saved.sort); setReadingFilter(isReadingStatus(saved.readingFilter) ? saved.readingFilter : "");
        }
      } catch { /* Returning to a book also works when storage is unavailable. */ }
      setReturnBook(id);
    }
    restoreBook();
    window.addEventListener("hashchange", restoreBook);
    return () => window.removeEventListener("hashchange", restoreBook);
  }, [collection.slug, initialBooks]);

  useEffect(() => {
    if (!returnBook || query !== deferredQuery) return;
    const index = filteredBooks.findIndex(book => book.id === returnBook);
    if (index < 0) {
      // An edit may change the title or author so it no longer matches the old filters.
      setQuery(""); setCategory(""); setAuthor(""); setLanguage(""); setReadingFilter("");
      return;
    }
    if (index >= limit) { setLimit(Math.ceil((index + 1) / 32) * 32); return; }
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(`book-${returnBook}`);
      card?.scrollIntoView({ block: "center" });
      card?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      setReturnBook(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [returnBook, filteredBooks, limit, query, deferredQuery]);

  function rememberBook(id: string) {
    try { sessionStorage.setItem(`catalogue-return:${collection.slug}`, JSON.stringify({ bookId: id, query, category, author, language, sort, readingFilter })); } catch { /* Optional view persistence. */ }
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#book-${encodeURIComponent(id)}`);
    dialogRef.current?.close();
  }

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

  useEffect(() => { setChosenBooks(new Set()); setBulkError(""); }, [query, category, author, language, readingFilter]);
  const displayedBooks = filteredBooks.slice(0, limit);
  const displayedSelected = displayedBooks.length > 0 && displayedBooks.every(book => chosenBooks.has(book.id));
  function chooseBooks(ids: string[], checked: boolean) {
    const next = new Set(chosenBooks);
    ids.forEach(id => checked ? next.add(id) : next.delete(id));
    if (next.size > 1000) { setBulkError("Select up to 1,000 books at a time."); return; }
    setChosenBooks(next); setBulkError(""); setBulkNotice("");
  }
  function applyBulkStatus() {
    const ids = [...chosenBooks];
    if (!ids.length) return;
    setBulkError(""); setBulkNotice("");
    startBulkTransition(async () => {
      try {
        const result = await changeBooksReadingStatus(collection.slug, ids, bulkStatus);
        if (result.error) { setBulkError(result.error); return; }
        setBooks(previous => previous.map(book => ids.includes(book.id) ? { ...book, readingStatus: bulkStatus } : book));
        setChosenBooks(new Set());
        setBulkNotice(t("Updated {0} books.", [result.updated]));
      } catch { setBulkError("Could not update the selected books. Please try again."); }
    });
  }

  function openBook(book: CatalogueBook) {
    setSelected(book);
    requestAnimationFrame(() => dialogRef.current?.showModal());
  }

  function reset() {
    setQuery("");
    setCategory("");
    setAuthor("");
    setLanguage("");
    setReadingFilter("");
    setSort("catalogue");
    setLimit(32);
  }

  return (
    <div className="catalogue-shell">
      <a className="skip" href="#catalogue">{t("Skip to books")}</a>
      <header className="masthead">
        <div className="brand"><img className="collection-brand-mark" src="/icon.svg" alt="" width={38} height={44} /><span>{collection.name}<small>{t("PUBLIC COLLECTION")}</small></span></div>
        <nav className="site-nav"><Link href="/">{t("All collections")}</Link>{canEdit ? <><Link className="button-link" href={`/collections/${collection.slug}/add`}>{t("+ Add by ISBN")}</Link><Link className="button-link" href={`/shelfies?collection=${collection.slug}`}>{t("+ Import shelf photo")}</Link><span className="edit-mode">{t("Editing enabled")}</span></> : viewerSignedIn ? <Link href="/?view=mine">{t("My collections")}</Link> : <Link href="/login">{t("Log in")}</Link>}</nav>
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
            <button className="filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="catalogue-filters" onClick={() => setFiltersOpen(!filtersOpen)}>{t("Filters")}{[category, author, language, readingFilter].filter(Boolean).length > 0 && ` (${[category, author, language, readingFilter].filter(Boolean).length})`}<span aria-hidden="true">{filtersOpen ? "−" : "+"}</span></button>
            <div id="catalogue-filters" className={`filter-body${filtersOpen ? " is-open" : ""}`}><div className="filter-heading"><h2>{t("Filters")}</h2><button type="button" onClick={reset} disabled={!activeFilters.length && sort === "catalogue"}>{t("Clear")}</button></div><div className="select-filters" onChange={() => setLimit(32)}>
              <label htmlFor="category">{t("Category")}</label><select id="category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{t("All")}</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
              <label htmlFor="author">{t("Author")}</label><select id="author" value={author} onChange={(event) => setAuthor(event.target.value)}><option value="">{t("All")}</option>{authors.map((value) => <option key={value}>{value}</option>)}</select>
              <label htmlFor="language">{t("Language")}</label><select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">{t("All")}</option>{languages.map((value) => <option key={value}>{value}</option>)}</select>
              <label htmlFor="reading-filter">{t("Reading status")}</label><select id="reading-filter" value={readingFilter} onChange={event => setReadingFilter(event.target.value)}><option value="">{t("All reading statuses")}</option><option value="unread">{t("Unread")}</option><option value="read">{t("Read")}</option><option value="radar">{t("On my radar")}</option></select>
            </div></div>
          </aside>
          <section id="catalogue" aria-busy={query !== deferredQuery} tabIndex={-1} aria-label={t("Collection books")}>
            <div className="catalogue-toolbar"><div><h2>{category || t("All books")}</h2><p role="status" aria-live="polite" aria-atomic="true">{filteredBooks.length} {" " + t("of") + " "}{initialBooks.length} {" " + t("books")}</p></div><div className="sort-wrap"><label htmlFor="sort">{t("Sort by")}</label><select id="sort" value={sort} onChange={(event) => { setSort(event.target.value); setLimit(32); }}><option value="catalogue">{t("Catalogue order")}</option><option value="title">{t("Title A–Z")}</option><option value="author">{t("Author A–Z")}</option></select></div></div>
            {activeFilters.length > 0 && <div className="active-filters" aria-label={t("Active filters")}>{activeFilters.map((filter) => <button key={filter.label} className="filter-chip" type="button" aria-label={t("Remove: {0} — {1}", [filter.label, filter.value])} onClick={() => { filter.clear(); setLimit(32); }}>{filter.label}: {filter.value}<span aria-hidden="true"> ×</span></button>)}</div>}
            {canEdit && <div className="bulk-reading-toolbar" aria-label={t("Bulk reading status")}>
              <label className="bulk-select-label"><input type="checkbox" checked={displayedSelected} disabled={bulkPending || !displayedBooks.length} onChange={event => chooseBooks(displayedBooks.map(book => book.id), event.target.checked)} />{t("Select displayed books")}</label>
              <span role="status">{t("{0} selected", [chosenBooks.size])}</span>
              <label htmlFor="bulk-reading-status">{t("Mark selected as")}</label>
              <select id="bulk-reading-status" value={bulkStatus} disabled={bulkPending} onChange={event => { if (isReadingStatus(event.target.value)) setBulkStatus(event.target.value); }}><option value="unread">{t("Unread")}</option><option value="read">{t("Read")}</option><option value="radar">{t("On my radar")}</option></select>
              <button className="button-link" type="button" disabled={bulkPending || !chosenBooks.size} onClick={applyBulkStatus}>{bulkPending ? t("Saving…") : t("Apply status")}</button>
              {chosenBooks.size > 0 && <button className="secondary-button" disabled={bulkPending} type="button" onClick={() => setChosenBooks(new Set())}>{t("Clear selection")}</button>}
            </div>}
            {bulkError && <p className="reading-error" role="alert">{t(bulkError)}</p>}
            {bulkNotice && <p role="status">{bulkNotice}</p>}
            <div className="book-grid">
              {displayedBooks.map((book) => <article className="book-card-shell" id={`book-${book.id}`} key={book.id}>{canEdit && <label className="book-selection"><input type="checkbox" checked={chosenBooks.has(book.id)} disabled={bulkPending} aria-label={t("Select {0}", [book.title])} onChange={event => chooseBooks([book.id], event.target.checked)} /><span>{t("Select book")}</span></label>}<button type="button" className="book-card" onClick={() => openBook(book)}>
                <div className="cover-wrap"><BookCoverImage src={book.cover} alt={t("Cover: ") + book.title} fallbackAlt={t("Cover unavailable")} loading="lazy" /></div>
                <h3>{book.title}</h3><p className="book-author">{book.author}</p>{book.series && <p className="book-series">{book.series}</p>}{book.isbn13 && <p className="book-isbn">{book.isbn13}</p>}
              </button><BookReadingStatus slug={collection.slug} legacyId={book.id} title={book.title} status={book.readingStatus} canEdit={canEdit} disabled={bulkPending} onSaved={status => setBooks(previous => previous.map(item => item.id === book.id ? { ...item, readingStatus: status } : item))} /></article>)}
            </div>
            {!filteredBooks.length && <div id="empty"><h3>{initialBooks.length ? t("No books found.") : t("This collection has no books yet.")}</h3>{initialBooks.length > 0 && <><p>{t("Try another search or remove a filter.")}</p><button type="button" onClick={reset}>{t("Show all")}</button></>}</div>}
            {filteredBooks.length > 0 && <div className="load-more" ref={sentinelRef}><p role="status" aria-live="polite">{t("Showing") + " "}{Math.min(limit, filteredBooks.length)} {" " + t("of") + " "}{filteredBooks.length} {" " + t("books")}</p>{filteredBooks.length > limit && !manualLoading && <p className="scroll-hint">{t("Scroll to discover more books")}</p>}{filteredBooks.length > limit && manualLoading && <button type="button" onClick={() => setLimit((value) => value + 32)}>{t("Show") + " "}{Math.min(32, filteredBooks.length - limit)} {" " + t("more books")}</button>}</div>}
          </section>
        </div>
      </main>
      <footer><span>{collection.name}</span><p>{t("Each record represents a physical volume in the collection.")}</p></footer>
      <dialog className="book-dialog" ref={dialogRef} aria-labelledby="book-detail-title" onClose={() => setSelected(null)} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close(); } }}>
        <div className="book-dialog-header"><button type="button" className="close-dialog" aria-label={t("Close")} onClick={() => { dialogRef.current?.close(); setSelected(null); }}>×</button></div>
        {selected && <div className="detail-layout"><div className="detail-art"><div className="cover-wrap"><BookCoverImage src={selected.cover} alt={t("Cover: ") + selected.title} fallbackAlt={t("Cover unavailable")} /></div></div><div className="detail-copy"><p className="eyebrow">{collection.name}</p><h2 id="book-detail-title">{selected.title}</h2><p className="detail-author">{selected.author}</p><dl>
          {selected.category && <><dt>{t("Category")}</dt><dd>{selected.category}</dd></>}
          {selected.language && <><dt>{t("Language")}</dt><dd>{selected.language}</dd></>}
          {selected.publisher && <><dt>{t("Publisher")}</dt><dd>{selected.publisher}</dd></>}
          {selected.isbn13 && <><dt>ISBN-13</dt><dd>{selected.isbn13}</dd></>}
          <dt>{t("Book ID")}</dt><dd>{selected.id}</dd>
        </dl>{canEdit && <div className="book-owner-actions"><Link className="secondary-button" href={`/collections/${collection.slug}/books/${selected.id}`} onClick={() => rememberBook(selected.id)}>{t("Edit book")}</Link><DeleteBookButton collectionId={collection.id} collectionSlug={collection.slug} legacyId={selected.id} title={selected.title} /></div>}</div></div>}
      </dialog>
    </div>
  );
}
