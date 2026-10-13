"use client";

import { deleteBook } from "@/app/admin/actions";

export function DeleteBookButton({
  collectionId,
  collectionSlug,
  legacyId,
  title,
}: {
  collectionId: string;
  collectionSlug: string;
  legacyId: string;
  title: string;
}) {
  return <form action={deleteBook} onSubmit={(event) => {
    if (!window.confirm(`Να διαγραφεί οριστικά το βιβλίο «${title}» από τη συλλογή;`)) event.preventDefault();
  }}>
    <input type="hidden" name="collectionId" value={collectionId} />
    <input type="hidden" name="collectionSlug" value={collectionSlug} />
    <input type="hidden" name="legacyId" value={legacyId} />
    <button className="delete-book-button" type="submit">Διαγραφή βιβλίου</button>
  </form>;
}
