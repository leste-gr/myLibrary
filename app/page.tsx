import { getPublicCatalogue } from "@/lib/catalogue";
import { Catalogue } from "@/components/catalogue";

export const revalidate = 60;

export default async function HomePage() {
  const books = await getPublicCatalogue();
  return <Catalogue initialBooks={books} />;
}
