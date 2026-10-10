import Link from "next/link";
import { assistantConfigured, assistantConfig } from "@/lib/assistant-config";

export const dynamic = "force-dynamic";

export default function ConnectPage() {
  const enabled = assistantConfigured();
  const installUrl = process.env.MYLIBRARY_ASSISTANT_INSTALL_URL;
  return <main className="shelfie-shell"><Link href="/shelfies">← Εισαγωγή βιβλίων</Link><p className="eyebrow">ΤΟ ΔΙΚΟ ΣΟΥ AI</p><h1>Σύνδεση με το ChatGPT</h1>
    <p className="shelfie-lead">Ανέβασε τη φωτογραφία στο ChatGPT και στείλε τα βιβλία κατευθείαν στο myLibrary για έλεγχο.</p>
    <ol className="connection-steps"><li>Πρόσθεσε τη σύνδεση myLibrary στο ChatGPT και συνδέσου στον λογαριασμό της βιβλιοθήκης σου.</li><li>Ανέβασε μια καθαρή φωτογραφία και ζήτησε: «Στείλε αυτά τα βιβλία στο myLibrary για έλεγχο».</li><li>Άνοιξε τον σύνδεσμο ελέγχου, διόρθωσε όσα χρειάζονται και πάτησε Εισαγωγή.</li></ol>
    {enabled ? <section className="genai-step"><h2>Σύνδεση myLibrary</h2>{installUrl && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(installUrl) ? <a className="button-link" href={installUrl}>Άνοιγμα στο ChatGPT</a> : <><p>Για λογαριασμούς που υποστηρίζουν προσαρμοσμένες συνδέσεις, πρόσθεσε την παρακάτω διεύθυνση ως MCP server στις ρυθμίσεις συνδέσεων του ChatGPT.</p><code className="connection-url">{assistantConfig().resource}</code></>}<p className="privacy-note">Η διαθεσιμότητα συνδέσεων εξαρτάται από το πλάνο και τις ρυθμίσεις του λογαριασμού σου.</p></section> : <p className="empty-admin">Η απευθείας σύνδεση δεν έχει ενεργοποιηθεί ακόμη. Η επικόλληση απάντησης είναι ήδη διαθέσιμη.</p>}
    <p>Το myLibrary λαμβάνει μόνο τα στοιχεία των βιβλίων. Η φωτογραφία παραμένει στο AI chat. Η σύνδεση δημιουργεί πρόχειρες εισαγωγές· η δημοσίευση γίνεται από εσένα.</p>
    <Link className="secondary-button" href="/shelfies">Συνέχεια με επικόλληση απάντησης</Link><p><Link href="/shelfies/connections">Διαχείριση συνδεδεμένων εφαρμογών</Link></p>
  </main>;
}
