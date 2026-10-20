"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "./language-provider";
import { BookCoverImage } from "./book-cover-image";
import { BookReadingStatus } from "./reading-status";
import type { RadarBook } from "@/lib/radar";

export function RadarBooks({ initialBooks }: { initialBooks: RadarBook[] }) {
  const t = useTranslations();
  const [books, setBooks] = useState(initialBooks);
  useEffect(() => { setBooks(initialBooks); }, [initialBooks]);
  const groups = useMemo(() => {
    const result = new Map<string, { name: string; isPublic: boolean; books: RadarBook[] }>();
    for (const book of books) {
      const group = result.get(book.collectionSlug) ?? { name: book.collectionName, isPublic: book.collectionIsPublic, books: [] };
      group.books.push(book); result.set(book.collectionSlug, group);
    }
    return [...result.entries()].sort((a,b) => a[1].name.localeCompare(b[1].name));
  }, [books]);
  return <div className="radar-books">
    <p role="status">{t("{0} books on your radar", [books.length])}</p>
    {!books.length && <section className="radar-empty"><h2>{t("Your next chapter is waiting.")}</h2>
      <p>{t("Mark books as On my radar in any of your collections to find them here.")}</p><Link className="button-link" href="/?view=mine">{t("My collections")}</Link></section>}
    {groups.map(([slug, group]) => <section key={slug} className="radar-collection" aria-label={group.name}>
      <h2>{group.isPublic ? <Link href={`/collections/${slug}`}>{group.name}</Link> : group.name}</h2>
      <div className="book-grid">{group.books.map(book => <article className="book-card-shell" key={book.id}>
        <Link className="book-card radar-book-link" href={`/collections/${slug}/books/${encodeURIComponent(book.legacyId)}`}>
          <div className="cover-wrap"><BookCoverImage src={book.cover} alt={t("Cover: ") + book.title} fallbackAlt={t("Cover unavailable")} loading="lazy" /></div>
          <h3>{book.title}</h3><p className="book-author">{book.author}</p>
        </Link>
        <BookReadingStatus slug={slug} legacyId={book.legacyId} title={book.title} status="radar" canEdit
          onSaved={status => { if (status !== "radar") setBooks(previous => previous.filter(item => item.id !== book.id)); }} />
      </article>)}</div>
    </section>)}
  </div>;
}
