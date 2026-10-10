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
  if (!assistantConfigured()) redirect("/shelfies/connect");
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=/shelfies");
  const grants = await client.auth.oauth.listGrants();
  const { error, revoked } = await searchParams;
  return <main className="shelfie-shell"><Link href="/shelfies">← Εισαγωγή βιβλίων</Link><h1>Συνδεδεμένες εφαρμογές</h1>
    {revoked && <p role="status">Η σύνδεση ανακλήθηκε.</p>}
    {(error || grants.error) && <p className="form-error" role="alert">{error === "revocation" ? "Η πρόσβαση στα βιβλία σταμάτησε, αλλά η ανάκληση στο OAuth δεν ολοκληρώθηκε. Δοκίμασε ξανά." : "Δεν ήταν δυνατή η ολοκλήρωση. Δοκίμασε ξανά."}</p>}
    {grants.data?.map((grant) => <section className="genai-step" key={grant.client.id}><h2>{grant.client.name}</h2><form action={revoke}><input type="hidden" name="clientId" value={grant.client.id} /><button className="secondary-button">Ανάκληση πρόσβασης</button></form></section>)}
    {!grants.error && !grants.data?.length && <p>Δεν υπάρχουν συνδεδεμένες εφαρμογές.</p>}
  </main>;
}
