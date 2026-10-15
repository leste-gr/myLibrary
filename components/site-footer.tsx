import Link from "next/link";

export function SiteFooter() {
  return <footer className="site-footer"><span>myLibrary</span><nav aria-label="Νομικές πληροφορίες"><Link href="/privacy">Πολιτική απορρήτου</Link><Link href="/terms">Όροι χρήσης</Link></nav></footer>;
}
