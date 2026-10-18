import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout } from "@/components/legal-layout";
import { legalContact } from "@/lib/legal-contact";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("Terms of Service") + " · Shelfie Street", description: t("Terms for using Shelfie Street, public book collections, and connected AI assistants.") };
}

export default async function TermsPage() {
  const t = await getTranslations();
  return <LegalLayout title={t("Terms of Service")}>
    <p>{t("These terms govern your use of Shelfie Street, operated by") + " "}{legalContact.operator}{t(". By creating an account or using the service, you agree to these terms. If you do not agree, do not use the service. Questions can be sent to") + " "}<a href={`mailto:${legalContact.email}`}>{legalContact.email}</a>{t(".")}</p>

    <h2>{t("1. The service")}</h2>
    <p>{t("Shelfie Street lets you catalogue books, publish collections, and import structured book information from an AI assistant or a file. Features may change over time. Connected AI providers, Google, book-data sources, and hosting providers are separate services with their own terms.")}</p>

    <h2>{t("2. Your account")}</h2>
    <p>{t("Use an account you are entitled to control and provide accurate information. You must have the legal capacity to accept these terms or the permission required by applicable law. Keep sign-in credentials secure, review application authorizations before approving them, and tell us if you suspect unauthorized access. Do not share passwords or personal access tokens with other users.")}</p>
    <p>{t("Google sign-in, when enabled, can create an account on your first sign-in or provide access to an existing account. Availability depends on Google and the service’s authentication settings.")}</p>

    <h2>{t("3. Your content and public visibility")}</h2>
    <p>{t("You retain the rights you hold in content you submit. You grant Shelfie Street a non-exclusive permission to store, process, reproduce, and display that content as necessary to provide the features you use, including public collection pages. This permission does not transfer ownership of your content.")}</p>
    <p>{t("Published collections and their book records are public. Do not submit confidential information, sensitive personal information, or content you are not entitled to share. You are responsible for reviewing collection names, book details, notes, and other information before publishing or authorizing an import.")}</p>
    <p>{t("Book covers, bibliographic records, and third-party material remain subject to their owners’ rights. A cover appearing in Shelfie Street does not give you a licence to reuse it elsewhere.")}</p>

    <h2>{t("4. Connected assistants and imports")}</h2>
    <p>{t("When you connect an assistant, you authorize the access and actions shown during consent. Supported actions include reading your collections and books, creating collections, and adding books. An authorized import may publish book records immediately.")}</p>
    <p>{t("Only request actions you intend the assistant to perform. You can revoke its access from") + " "}<Link href="/shelfies/connections">{t("Connected applications")}</Link>{t(". Revoking access does not undo completed imports or delete information already held by the assistant provider. Website logout and plugin revocation are separate actions.")}</p>
    <p>{t("Photographs supplied to an external AI service are governed by that service’s terms. Shelfie Street receives structured book information through the current import workflow, not the original photograph.")}</p>

    <h2>{t("5. Accuracy and representative covers")}</h2>
    <p>{t("AI extraction, bibliographic matching, and cover discovery can make mistakes. Titles, authors, ISBNs, editions, volumes, and images may be incomplete or incorrect. A displayed cover may represent another edition or language of the same work. A representative cover is not proof of the physical book’s edition or ISBN.")}</p>
    <p>{t("Review imported records and correct errors. A successful import means the data was accepted by the service; it does not certify that every bibliographic claim has been verified.")}</p>

    <h2>{t("6. Acceptable use")}</h2>
    <p>{t("Do not use Shelfie Street to infringe intellectual-property or privacy rights, publish unlawful or abusive material, impersonate another person, access another user’s account or private data without permission, bypass access controls, introduce malicious code, or disrupt the service. Automated use must respect applicable access controls, rate limits, and third-party terms.")}</p>

    <h2>{t("7. Availability and external services")}</h2>
    <p>{t("We aim to provide a useful service, but do not promise uninterrupted availability, permanent storage, or error-free results. External sign-in, AI, catalogue, and image providers may change, restrict access, or become unavailable. Keep your own copy of information you cannot afford to lose.")}</p>
    <p>{t("To the extent permitted by law, the service is provided as available without additional warranties. Nothing in these terms excludes mandatory consumer rights or liability that cannot lawfully be excluded, including liability for fraud or intentional wrongdoing.")}</p>

    <h2>{t("8. Suspension, deletion, and ending use")}</h2>
    <p>{t("You can stop using the service, revoke connected applications, and delete your owned books or collections. To request account deletion, email") + " "}<a href={`mailto:${legalContact.email}`}>{legalContact.email}</a>{t(". The") + " "}<Link href="/privacy">{t("Privacy Policy")}</Link> {" " + t("explains retention and deletion limits.")}</p>
    <p>{t("We may restrict or suspend access when reasonably necessary to address a breach of these terms, a security threat, unlawful content, or a legal requirement. Where appropriate and lawful, we will provide notice and a way to contact us about the decision. Service changes or discontinuation may also affect availability.")}</p>

    <h2>{t("9. Rights concerns and disputes")}</h2>
    <p>{t("For a privacy, copyright, or content concern, email") + " "}<a href={`mailto:${legalContact.email}`}>{legalContact.email}</a> {" " + t("with the affected URL and enough detail to identify the issue. Do not include passwords or tokens. We will review requests and may ask for information needed to establish identity or authority.")}</p>
    <p>{t("Please contact us first so we can try to resolve a dispute. These terms do not remove any mandatory protections or rights to bring a claim before a competent court or authority under applicable law.")}</p>

    <h2>{t("10. Changes to these terms")}</h2>
    <p>{t("We may revise these terms as the service develops. The date above shows the latest version. We will provide additional notice of material changes where required. Continuing to use the service after updated terms take effect means you accept them, subject to applicable law.")}</p>
  </LegalLayout>;
}
