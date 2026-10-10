import Link from "next/link";
import { ShelfieReview } from "@/components/shelfie-review";

export default function TryShelfiePage() {
  return <main className="shelfie-shell"><Link href="/">← Όλες οι συλλογές</Link><p className="eyebrow">ΔΟΚΙΜΗ ΕΙΣΑΓΩΓΗΣ</p><h1>Από το AI στη βιβλιοθήκη σου</h1><p className="shelfie-lead">Δοκίμασε την επικόλληση και τον έλεγχο βιβλίων. Σε αυτή τη σελίδα δεν αποθηκεύεται ή δημοσιεύεται τίποτα.</p><ShelfieReview userId="" collections={[]} canImport={false} /></main>;
}
