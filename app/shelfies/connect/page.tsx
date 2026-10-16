import { getTranslations } from "@/lib/i18n/server";
import Link from "next/link";
import { assistantConfigured, assistantConfig } from "@/lib/assistant-config";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const t = await getTranslations();
  const enabled = assistantConfigured();
  const installUrl = process.env.MYLIBRARY_ASSISTANT_INSTALL_URL;
  return <main className="shelfie-shell"><Link href="/shelfies">{t("← Import books")}</Link><p className="eyebrow">{t("YOUR OWN AI")}</p><h1>{t("Connect to ChatGPT")}</h1>
    <p className="shelfie-lead">{t("Upload a photo to ChatGPT and send the books directly to myLibrary for review.")}</p>
    <ol className="connection-steps"><li>{t("Add the myLibrary connection in ChatGPT and log in with Google or email and password. You can also create a new account.")}</li><li>{t("Upload a clear photo and ask: “Send these books to myLibrary for review.”")}</li><li>{t("Approve access to your library and request a new collection or add books to an existing one. Open the collection link to see the result.")}</li></ol>
    {enabled ? <section className="genai-step"><h2>{t("Connect myLibrary")}</h2>{installUrl && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(installUrl) ? <a className="button-link" href={installUrl}>{t("Open in ChatGPT")}</a> : <><p>{t("For accounts that support custom connections, add the address below as an MCP server and choose OAuth in ChatGPT's connection settings.")}</p><code className="connection-url">{assistantConfig().resource}</code><p>{t("You don't need a personal token or API key. Log in or register with Google or email and password, then approve access to your own library.")}</p></>}<p className="privacy-note">{t("Connection availability depends on your plan and account settings.")}</p></section> : <p className="empty-admin">{t("The direct connection is not enabled yet. Pasting a response is already available.")}</p>}
    <p>{t("myLibrary receives only book details. The photo stays in your AI chat. After your explicit request, the connection can create a collection or add books to an existing one.")}</p>
    <Link className="secondary-button" href="/shelfies">{t("Continue by pasting a response")}</Link><p><Link href="/shelfies/connections">{t("Manage connected applications")}</Link></p>
  </main>;
}
