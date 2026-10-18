import Link from "next/link";
export function Brand() {
  return <Link href="/" className="street-brand" aria-label="Shelfie Street"><img src="/icon.svg" alt="" width={40} height={46} /><span>Shelfie<small>Street</small></span></Link>;
}
