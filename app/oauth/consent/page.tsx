import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assistantConfigured } from "@/lib/assistant-config";

export const dynamic = "force-dynamic";

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
    if (data.scope.split(" ").some((scope) => scope && scope !== "openid")) redirect(`${back}&error=scope`);
    const enabled = await client.rpc("assistant_client_enabled", { target_client_id: data.client.id });
    if (enabled.error || enabled.data !== true) redirect(`${back}&error=client`);
    const grant = await client.rpc("set_assistant_connection", { target_client_id: data.client.id, allow_access: true });
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
  if (!assistantConfigured()) return <main className="login-card"><h1>Η σύνδεση δεν είναι διαθέσιμη ακόμη</h1><Link href="/shelfies/connect">Οδηγίες σύνδεσης</Link></main>;
  const { authorization_id: id, error: requestError } = await searchParams;
  if (!id) return <main className="login-card"><h1>Μη έγκυρο αίτημα σύνδεσης</h1><p>Ξεκίνα τη σύνδεση από το AI chat σου.</p></main>;
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${encodeURIComponent(id)}`)}`);
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <main className="login-card"><h1>Το αίτημα έληξε</h1><p>Ξεκίνα ξανά τη σύνδεση από το AI chat.</p><Link href="/shelfies">Επιστροφή</Link></main>;
  if (!("authorization_id" in data)) redirect(data.redirect_url);
  const enabled = await client.rpc("assistant_client_enabled", { target_client_id: data.client.id });
  const canApprove = !enabled.error && enabled.data === true && data.scope.split(" ").every((scope) => !scope || scope === "openid");
  return <main className="login-card"><p className="eyebrow">MYLIBRARY</p><h1>Σύνδεση εφαρμογής</h1><p><strong>{data.client.name}</strong> ζητά σύνδεση με τη βιβλιοθήκη σου.</p>
    <p>Λογαριασμός: {user.email}</p><ul><li>Βλέπει τις συλλογές σου ως προορισμούς εισαγωγής.</li><li>Στέλνει στοιχεία βιβλίων σε ιδιωτικά πρόχειρα για έλεγχο.</li><li>Δεν μπορεί να δημοσιεύσει, να επεξεργαστεί ή να διαγράψει βιβλία.</li></ul>
    <p className="privacy-note">Η φωτογραφία μένει στο AI chat. Μπορείς να ανακαλέσεις τη σύνδεση από τη διαχείριση εφαρμογών.</p>
    <p className="privacy-note">Επιστροφή σε: {new URL(data.redirect_uri).origin}<br />Δικαιώματα ταυτότητας: {data.scope || "κανένα"}</p>
    {(!canApprove || requestError) && <p className="form-error" role="alert">{!canApprove ? "Αυτή η εφαρμογή ή τα δικαιώματά της δεν έχουν ενεργοποιηθεί από τον διαχειριστή." : "Η σύνδεση δεν ολοκληρώθηκε. Δοκίμασε ξανά από το AI chat."}</p>}
    <form action={decide} className="publish-actions"><input type="hidden" name="authorizationId" value={id} /><button className="primary-button" name="decision" value="approve" disabled={!canApprove}>Σύνδεση εφαρμογής</button><button className="secondary-button" name="decision" value="deny">Ακύρωση</button></form>
  </main>;
}
