import { notFound } from "next/navigation";
import { Catalogue } from "@/components/catalogue";
import { getPublicCatalogue, getPublicCollection } from "@/lib/catalogue";

export const revalidate = 60;

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [collection, books] = await Promise.all([
    getPublicCollection(slug),
    getPublicCatalogue(slug),
  ]);
  if (!collection) notFound();
  return <Catalogue initialBooks={books} collection={collection} />;
}
