import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "@/components/legal-layout";
import { legalContact } from "@/lib/legal-contact";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("Privacy Policy") + " · myLibrary", description: t("How myLibrary handles account information, public book collections, Google sign-in, and connected assistants.") };
}

export default async function PrivacyPage() {
  const t = await getTranslations();
  return <LegalLayout title={t("Privacy Policy")}>
    <p>{t("myLibrary helps you catalogue a physical book collection and share it on the web. This policy explains what information the service uses, when it becomes public, and the choices you have.")}</p>

    <h2>{t("1. Who operates myLibrary")}</h2>
    <p>{t("myLibrary is operated by") + " "}{legalContact.operator}{t(", who is responsible for personal data processed through the service. For privacy questions or requests, email") + " "}<a href={`mailto:${legalContact.email}`}>{legalContact.email}</a>{t(".")}</p>

    <h2>{t("2. Information we process")}</h2>
    <ul>
      <li><strong>{t("Account information:")}</strong> {" " + t("your user ID, email address, sign-in details, and profile information supplied by your sign-in provider, such as your name. Supabase manages authentication and sessions.")}</li>
      <li><strong>{t("Library information:")}</strong> {" " + t("collection names and descriptions, book titles, authors, language, ISBNs, covers, notes, and other details you submit or approve.")}</li>
      <li><strong>{t("Import and connection records:")}</strong> {" " + t("structured book payloads, literal text extracted by your assistant, confidence scores, matching results, import history, and records of application consent or revocation.")}</li>
      <li><strong>{t("Technical information:")}</strong> {" " + t("requests, IP addresses and browser information processed by hosting or authentication providers, session cookies, and operational logs used to deliver and protect the service.")}</li>
      <li><strong>{t("Correspondence:")}</strong> {" " + t("information you send when asking for support or exercising a privacy right.")}</li>
    </ul>

    <h2>{t("3. Public collections")}</h2>
    <p>{t("Published collections and their book records are publicly readable without signing in. Collection names, descriptions, book details, notes, and covers may be indexed by search engines or copied by visitors. Your account email is not displayed as a public account field, but information you include in a collection or book record can become public. Do not include private information in those fields.")}</p>
    <p>{t("Connected assistants can create collections and add books directly after your authorization. Those imported records can appear immediately on the public collection page.")}</p>

    <h2>{t("4. Google sign-in")}</h2>
    <p>{t("When Google sign-in is enabled and you choose it, Google authenticates you and supplies the basic identity information needed to create or access your myLibrary account. Your Google password is entered with Google, not with myLibrary. The sign-in flow requests basic identity access, not access to your Gmail, Drive files, or contacts.")}</p>
    <p>{t("Google handles information under its") + " "}<a href="https://policies.google.com/privacy" rel="noreferrer">{t("Privacy Policy")}</a>{t(". Account and session information returned to myLibrary is used for sign-in, account management, and service security.")}</p>

    <h2>{t("5. AI assistants and photographs")}</h2>
    <p>{t("You choose the AI service used to interpret shelf photographs. In the current shelf-photo workflow, you upload photographs to that service; myLibrary receives the structured book data you paste, upload, or authorize the assistant to send. myLibrary does not receive the original shelf photograph through that workflow.")}</p>
    <p>{t("A connected assistant can access your collections and books and perform the actions described on the authorization screen. It uses your own authorized connection. Your AI provider processes photographs, prompts, and tool results under its own terms and privacy policy. Review those before sharing sensitive information.")}</p>
    <p>{t("myLibrary does not call a paid generative AI model to interpret your photographs. It can search book catalogues and web sources to fill missing bibliographic information or covers.")}</p>

    <h2>{t("6. Why we use information")}</h2>
    <p>{t("We use information to authenticate users, maintain and display their libraries, process requested imports, resolve book metadata and covers, manage connected applications, respond to requests, and prevent misuse.")}</p>
    <p>{t("Where data protection law requires a legal basis, processing needed to provide the requested service is based on performance of our agreement with you; security and troubleshooting are based on legitimate interests, balanced against your rights; and records required by law are processed to meet legal obligations. Where consent is required, we rely on that consent and provide a way to withdraw it.")}</p>

    <h2>{t("7. Providers and disclosures")}</h2>
    <p>{t("myLibrary uses") + " "}<a href="https://vercel.com/legal/privacy-policy" rel="noreferrer">{t("Vercel")}</a> {" " + t("for hosting and") + " "}<a href="https://supabase.com/privacy" rel="noreferrer">{t("Supabase")}</a> {" " + t("for the database and authentication. These providers process information needed to operate the service.")}</p>
    <p>{t("Book discovery may send titles, authors, ISBNs, language, publishers, or series details to Open Library, Google Books, search engines, or book websites. Displaying a cover from an external image host can send your browser’s IP address, request headers, and referrer information to that host. The site also loads fonts from Google Fonts.")}</p>
    <p>{t("We do not sell personal data or use account information for targeted advertising. Information may also be disclosed when necessary to comply with law, protect rights, or respond to a valid legal request.")}</p>
    <p>{t("Providers may process information outside your country, including outside the European Economic Area. Applicable international-transfer safeguards and provider practices depend on the service and location involved. Contact us for information about the safeguards relevant to your data.")}</p>

    <h2>{t("8. Cookies and browser storage")}</h2>
    <p>{t("myLibrary uses authentication and security cookies or browser storage to maintain your session and complete sign-in. Blocking them can prevent login or account actions. The application does not currently include advertising or analytics tracking. Google and other external services may apply their own storage practices when you use them.")}</p>

    <p>{t("We also store your chosen interface language in a preference cookie.")}</p>

    <h2>{t("9. Retention and deletion")}</h2>
    <p>{t("We retain account and library data while needed to provide the service. You can delete owned books and collections using the website. Deletion removes them from the active collection, but related import history, audit records, security logs, provider caches, or backups may remain until their applicable retention or deletion processes complete. Copies already made by visitors or search engines are outside our direct control.")}</p>
    <p>{t("To request deletion of your account and associated personal data, email") + " "}<a href={`mailto:${legalContact.email}`}>{legalContact.email}</a>{t(", preferably from the address linked to your account. We may need to verify your identity. We will explain any information that must be retained for legal or security reasons. Do not send passwords or access tokens.")}</p>

    <h2>{t("10. Your choices and rights")}</h2>
    <p>{t("You can edit or delete owned library records, log out of the website, and revoke a connected assistant from") + " "}<Link href="/shelfies/connections">{t("Connected applications")}</Link>{t(". Logging out of the website does not by itself revoke a plugin’s separate authorization.")}</p>
    <p>{t("Depending on applicable law, you may have rights to access, correct, erase, restrict, object to processing of, or receive a portable copy of your personal data, and to withdraw consent where processing relies on it. Contact us to make a request. If GDPR applies, you may also complain to your local data protection authority. These rights are subject to the conditions and exceptions provided by law.")}</p>

    <h2>{t("11. Changes")}</h2>
    <p>{t("We may update this policy as the service changes. The date above identifies the latest version. Where required by law, we will provide additional notice of material changes.")}</p>
  </LegalLayout>;
}
