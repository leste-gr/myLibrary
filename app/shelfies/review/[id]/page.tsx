import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShelfieReview } from "@/components/shelfie-review";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { parseManualGenaiImport } from "@/lib/manual-genai-import";

export const dynamic = "force-dynamic";
async function discard(form: FormData) {
  "use server";
  const client = await createSupabaseServerClient();
  const id = String(form.get("draftId") ?? "");
  const { error } = await client.rpc("discard_shelfie_draft", { target_draft_id: id });
  if (error) redirect(`/shelfies/review/${encodeURIComponent(id)}?error=discard`);
  redirect("/shelfies");
}
export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const t = await getTranslations();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (!isSupabaseConfigured()) redirect("/shelfies/connect");
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/shelfies/review/${id}`)}`);
  const { data: draft, error } = await client.from("shelfie_import_drafts").select("id,collection_id,payload,status,import_result").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (error) return <main className="shelfie-shell"><h1>{t("Could not load the import")}</h1><p>{t("Try refreshing the page.")}</p><Link href="/shelfies">{t("Back")}</Link></main>;
  if (!draft) notFound();
  const { data: collection } = await client.from("collections").select("id,slug,name").eq("id", draft.collection_id).eq("owner_id", user.id).single();
  if (!collection) notFound();
  if (draft.status !== "pending") return <main className="shelfie-shell"><h1>{draft.status === "imported" ? t("These books have already been imported") : t("Import rejected")}</h1><Link href={`/collections/${collection.slug}`}>{t("Open collection")}</Link></main>;
  let payload;
  try { payload = parseManualGenaiImport(draft.payload); } catch { payload = null; }
  return <main className="shelfie-shell"><Link href="/shelfies">{t("← All imports")}</Link><p className="eyebrow">{t("PRIVATE DRAFT")}</p><h1>{t("From your AI to your collection")}</h1><p className="shelfie-lead">{t("Destination:") + " "}{collection.name}{t(". Check the details before publishing.")}</p>
    {(await searchParams).error && <p className="form-error" role="alert">{t("Could not reject the import. Please try again.")}</p>}
    {payload ? <ShelfieReview userId={user.id} collections={[collection]} initialDraft={{ id, payload }} /> : <p className="form-error">{t("The draft contains invalid data. Ask the chat for a new export.")}</p>}
    <form action={discard} className="discard-draft"><input type="hidden" name="draftId" value={id} /><button className="secondary-button">{t("Reject this import")}</button></form>
  </main>;
}
