"use client";

import { deleteCollection } from "@/app/admin/actions";

export function DeleteCollectionButton({ collectionId, collectionName }: { collectionId: string; collectionName: string }) {
  return <form action={deleteCollection} onSubmit={(event) => {
    if (!window.confirm(`Να διαγραφεί οριστικά η συλλογή «${collectionName}» και όλα τα βιβλία της;`)) event.preventDefault();
  }}>
    <input type="hidden" name="collectionId" value={collectionId} />
    <button className="danger-button" type="submit">Διαγραφή συλλογής</button>
  </form>;
}
