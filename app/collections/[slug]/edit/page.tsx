import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { CollectionEditor } from "@/components/collection-editor";

export const dynamic = "force-dynamic";

export default async function EditCollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=" + encodeURIComponent(`/collections/${slug}/edit`));
  const { data: collection, error } = await supabase.from("collections")
    .select("name,description").eq("slug", slug).eq("owner_id", user.id).maybeSingle();
  if (error) throw new Error("Unable to load collection details.");
  if (!collection) notFound();
  const t = await getTranslations();
  return <main className="shelfie-shell"><h1>{t("Edit collection")}</h1>
    <CollectionEditor slug={slug} name={collection.name} description={collection.description} />
  </main>;
}
