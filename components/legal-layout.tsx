import Link from "next/link";
import { legalUpdated } from "@/lib/legal-contact";

export function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="legal-page" lang="en">
    <Link href="/">← myLibrary</Link>
    <p className="eyebrow">MYLIBRARY</p>
    <h1>{title}</h1>
    <p className="legal-updated">Last updated: {legalUpdated}</p>
    <nav className="legal-nav" aria-label="Legal information"><Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms of Service</Link></nav>
    <article>{children}</article>
  </main>;
}
