import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type AdminCopy = {
  id: string;
  legacy_id: string;
  work: { title: string; author: string } | { title: string; author: string }[];
  edition: { isbn13: string | null } | { isbn13: string | null }[] | null;
  copy_drafts: Relation<{ copy_id: string }>;
  edition_candidates: { count: number }[];
};

type Relation<T> = T | T[] | null;

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function AdminPage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("copies").select(
    "id,legacy_id,work:works(title,author),edition:editions(isbn13),copy_drafts(copy_id),edition_candidates(count)"
  ).order("display_order");
  if (error) throw new Error(error.message);
  const copies = (data ?? []) as AdminCopy[];
  const drafts = copies.filter((copy) => first(copy.copy_drafts)).length;
  const mapped = copies.filter((copy) => first(copy.edition)?.isbn13).length;

  return <>
    <p>Επίλεξε ένα βιβλίο για να ελέγξεις τις πιθανές εκδόσεις, να αποθηκεύσεις πρόχειρη επιλογή και να τη δημοσιεύσεις.</p>
    <section className="admin-summary">
      <div><strong>{copies.length}</strong><span>φυσικά αντίτυπα</span></div>
      <div><strong>{mapped}</strong><span>δημοσιευμένα ISBN</span></div>
      <div><strong>{drafts}</strong><span>πρόχειρες αλλαγές</span></div>
    </section>
    <div className="admin-list">
      {copies.map((copy) => {
        const work = first(copy.work);
        const edition = first(copy.edition);
        const candidateCount = copy.edition_candidates[0]?.count ?? 0;
        const draft = first(copy.copy_drafts);
        return <Link className="admin-row" href={"/admin/books/" + copy.legacy_id} key={copy.id}>
          <code>{copy.legacy_id}</code>
          <span><strong>{work?.title}</strong><small>{work?.author}</small></span>
          <span>{edition?.isbn13 ?? "Χωρίς ISBN"}</span>
          <span className={"status-pill " + (draft ? "draft" : "")}>{draft ? "Πρόχειρο" : candidateCount + " επιλογές"}</span>
        </Link>;
      })}
    </div>
  </>;
}
