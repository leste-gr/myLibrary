import { unstable_cache } from "next/cache";
import { getPublicCatalogue, getPublicCollection, getPublicCollections } from "./catalogue";

// Only anonymous public-view data enters this shared cache. Session and owner
// checks stay request-scoped. Existing revalidatePath calls expire edited pages.
// The short TTL also refreshes externally changed collection contents.
const publicDataset = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "unconfigured";
export const getCachedPublicCollections = unstable_cache(getPublicCollections,
  ["public-collection-directory-v1", publicDataset], { revalidate: 30 });
export const getCachedPublicCollection = unstable_cache(getPublicCollection,
  ["public-collection-v1", publicDataset], { revalidate: 30 });
export const getCachedPublicCatalogue = unstable_cache(getPublicCatalogue,
  ["public-collection-books-v1", publicDataset], { revalidate: 30 });
