import { getLocale, getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShelfieReview } from "@/components/shelfie-review";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { assistantConfigured } from "@/lib/assistant-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ShelfiePage({ searchParams }: { searchParams: Promise<{ collection?: string }> }) {
  const t = await getTranslations();
  const locale = await getLocale();
  if (!isSupabaseConfigured()) redirect("/shelfies/try");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/shelfies");

  const { collection: requestedSlug } = await searchParams;
  const { data } = await supabase
    .from("collections")
    .select("id,slug,name")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });
  const collections = data ?? [];
  const ordered = requestedSlug
    ? [...collections].sort((left, right) => Number(right.slug === requestedSlug) - Number(left.slug === requestedSlug))
    : collections;
  const drafts = assistantConfigured() ? await supabase.from("shelfie_import_drafts").select("id,created_at,payload").eq("owner_id", user.id).eq("status", "pending").order("created_at", { ascending: false }).limit(20) : null;

  return <main className="shelfie-shell">
    <Link href={requestedSlug ? `/collections/${requestedSlug}` : "/"}>{t("← Back")}</Link>
    <p className="eyebrow">{t("ADD BOOKS")}</p>
    <h1>{t("Import from a shelf photo")}</h1>
    <p className="shelfie-lead">{t("Read the photo with your own AI and review the books before adding them.")}</p>
    <section className="assistant-callout"><h2>{t("Directly from ChatGPT")}</h2><p>{assistantConfigured() ? t("Connect myLibrary and ask the chat to send your books for review.") : t("The direct connection is being prepared. You can already paste a response below.")}</p><Link href="/shelfies/connect">{t("How to connect →")}</Link></section>
    {drafts?.error && <p className="form-error" role="alert">{t("Could not load draft imports. Try refreshing the page.")}</p>}
    {Boolean(drafts?.data?.length) && <section className="draft-inbox"><h2>{t("Waiting for review")}</h2>{drafts?.data?.map((draft) => <Link key={draft.id} href={`/shelfies/review/${draft.id}`}>{t("Review") + " "}{Array.isArray(draft.payload?.books) ? draft.payload.books.length : ""} {" " + t("books ·") + " "}{new Date(draft.created_at).toLocaleDateString(locale === "el" ? "el-GR" : "en-GB")}</Link>)}</section>}
    <ShelfieReview userId={user.id} collections={ordered} />
    <p className="privacy-note">{t("Your photo is never sent to myLibrary. The terms and privacy policy of your chosen AI chat apply.")}</p>
  </main>;
}
