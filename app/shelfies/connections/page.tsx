import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assistantConfigured } from "@/lib/assistant-config";

export const dynamic = "force-dynamic";
async function revoke(form: FormData) {
  "use server";
  if (!assistantConfigured()) redirect("/shelfies/connect");
  const client = await createSupabaseServerClient();
  const id = String(form.get("clientId") ?? "");
  const stopped = await client.rpc("set_assistant_connection", { target_client_id: id, allow_access: false });
  if (stopped.error) redirect("/shelfies/connections?error=1");
  const result = await client.auth.oauth.revokeGrant({ clientId: id });
  redirect(`/shelfies/connections?${result.error ? "error=revocation" : "revoked=1"}`);
}
export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ error?: string; revoked?: string }> }) {
  const t = await getTranslations();
  if (!assistantConfigured()) redirect("/shelfies/connect");
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=/shelfies/connections");
  const grants = await client.auth.oauth.listGrants();
  const { error, revoked } = await searchParams;
  return <main className="shelfie-shell"><Link href="/shelfies">{t("← Import books")}</Link><h1>{t("Connected applications")}</h1>
    {revoked && <p role="status">{t("Connection revoked.")}</p>}
    {(error || grants.error) && <p className="form-error" role="alert">{error === "revocation" ? t("Access to your books has stopped, but OAuth revocation did not complete. Please try again.") : t("Could not complete this action. Please try again.")}</p>}
    {grants.data?.map((grant) => <section className="genai-step" key={grant.client.id}><h2>{grant.client.name}</h2><form action={revoke}><input type="hidden" name="clientId" value={grant.client.id} /><button className="secondary-button">{t("Revoke access")}</button></form></section>)}
    {!grants.error && !grants.data?.length && <p>{t("No connected applications yet.")}</p>}
  </main>;
}
