import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assistantConfigured } from "@/lib/assistant-config";

export const dynamic = "force-dynamic";

const allowedScopes = new Set(["openid", "email", "offline_access"]);
const scopesAllowed = (scope: string) => scope.split(" ").every((item) => !item || allowedScopes.has(item));

async function decide(form: FormData) {
  "use server";
  if (!assistantConfigured()) redirect("/shelfies/connect");
  const id = String(form.get("authorizationId") ?? "");
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${encodeURIComponent(id)}`)}`);
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(id);
  const back = `/oauth/consent?authorization_id=${encodeURIComponent(id)}`;
  if (error || !data) redirect(`${back}&error=expired`);
  if (!("authorization_id" in data)) redirect(data.redirect_url);
  if (form.get("decision") === "approve") {
    if (!scopesAllowed(data.scope)) redirect(`${back}&error=scope`);
    const enabled = await client.rpc("assistant_authorization_allowed", { target_authorization_id: id });
    if (enabled.error || enabled.data !== true) redirect(`${back}&error=client`);
    const grant = await client.rpc("authorize_assistant_connection", { target_authorization_id: id });
    if (grant.error) redirect(`${back}&error=connection`);
    const result = await client.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true });
    if (result.error || !result.data) redirect(`${back}&error=approval`);
    redirect(result.data.redirect_url);
  }
  const result = await client.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (result.error || !result.data) redirect(`${back}&error=expired`);
  redirect(result.data.redirect_url);
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string; error?: string }> }) {
  const t = await getTranslations();
  if (!assistantConfigured()) return <main className="login-card"><h1>{t("Connection is not available yet")}</h1><Link href="/shelfies/connect">{t("Connection instructions")}</Link></main>;
  const { authorization_id: id, error: requestError } = await searchParams;
  if (!id) return <main className="login-card"><h1>{t("Invalid connection request")}</h1><p>{t("Start connecting from your AI chat.")}</p></main>;
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${encodeURIComponent(id)}`)}`);
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <main className="login-card"><h1>{t("This request has expired")}</h1><p>{t("Start connecting again from your AI chat.")}</p><Link href="/shelfies">{t("Back")}</Link></main>;
  if (!("authorization_id" in data)) redirect(data.redirect_url);
  const enabled = await client.rpc("assistant_authorization_allowed", { target_authorization_id: id });
  const canApprove = !enabled.error && enabled.data === true && scopesAllowed(data.scope);
  return <main className="login-card"><p className="eyebrow">{t("SHELFIE STREET")}</p><h1>{t("Connect application")}</h1><p><strong>{data.client.name}</strong> {" " + t("requests access to your library.")}</p>
    <p>{t("Account:") + " "}{user.email}</p><ul><li>{t("Read your collections and their books.")}</li><li>{t("Create collections and add books when you request it.")}</li><li>{t("Imported books appear on the collection's public page.")}</li><li>{t("Cannot delete collections or books.")}</li></ul>
    <p className="privacy-note">{t("The photo stays in your AI chat. You can revoke access from connected applications.")}</p>
    <p className="privacy-note">{t("Return to:") + " "}{new URL(data.redirect_uri).origin}<br />{t("Identity permissions:") + " "}{data.scope || t("none")}</p>
    {(!canApprove || requestError) && <p className="form-error" role="alert">{!canApprove ? t("This connection request is invalid, has expired, or the application has been disabled. Start again from your AI chat.") : t("Connection failed. Try again from your AI chat.")}</p>}
    <form action={decide} className="publish-actions"><input type="hidden" name="authorizationId" value={id} /><button className="primary-button" name="decision" value="approve" disabled={!canApprove}>{t("Connect application")}</button><button className="secondary-button" name="decision" value="deny">{t("Cancel")}</button></form>
  </main>;
}
