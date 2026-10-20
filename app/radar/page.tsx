import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTranslations } from "@/lib/i18n/server";
import { getRadarBooks } from "@/lib/radar";
import { RadarBooks } from "@/components/radar-books";

export const dynamic = "force-dynamic";

export default async function RadarPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=%2Fradar");
  const t = await getTranslations();
  const books = await getRadarBooks(supabase, user.id);
  return <main className="radar-shell catalogue-shell">
    <Link href="/?view=mine">{t("My collections")}</Link>
    <section className="intro"><div><p className="eyebrow">{t("YOUR NEXT CHAPTER")}</p><h1>{t("On my radar")}</h1>
      <p className="intro-copy">{t("The books you want to read, from all your collections.")}</p></div></section>
    <RadarBooks initialBooks={books} />
  </main>;
}
