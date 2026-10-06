import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { discardEditionDraft, publishEditionDraft, saveEditionDraft } from "../../actions";

type Relation<T> = T | T[] | null;
type Work = { title: string; author: string };
type Edition = { isbn13: string | null; title: string | null; publishers: string[]; published_date: string | null; cover_url: string | null };
type Draft = { edition_id: string; cover_url: string | null; edition: Relation<Edition> };
type Copy = { id: string; legacy_id: string; category: string; language: string; cover_url: string | null; work: Relation<Work>; edition: Relation<Edition>; copy_drafts: Relation<Draft> };
type Candidate = { id: string; isbn13: string; title: string | null; publishers: string[]; published_date: string | null; cover_url: string | null; provider: string; score: number; suggested: boolean; rank: number };

function first<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function AdminBookPage({ params, searchParams }: { params: Promise<{ legacyId: string }>; searchParams: Promise<{ saved?: string; published?: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const { legacyId } = await params;
  const messages = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: collection } = await supabase.from("collections").select("id").eq("owner_id", user.id).single();
  if (!collection) notFound();
  const { data, error } = await supabase.from("copies").select(
    "id,legacy_id,category,language,cover_url,work:works(title,author),edition:editions(isbn13,title,publishers,published_date,cover_url),copy_drafts(edition_id,cover_url,edition:editions(isbn13,title,publishers,published_date,cover_url))"
  ).eq("collection_id", collection.id).eq("legacy_id", legacyId).single();
  if (error || !data) notFound();
  const copy = data as Copy;
  const { data: candidateData, error: candidateError } = await supabase.from("edition_candidates").select(
    "id,isbn13,title,publishers,published_date,cover_url,provider,score,suggested,rank"
  ).eq("copy_id", copy.id).order("rank");
  if (candidateError) throw new Error(candidateError.message);
  const candidates = (candidateData ?? []) as Candidate[];
  const work = first(copy.work);
  const edition = first(copy.edition);
  const draft = first(copy.copy_drafts);
  const draftEdition = draft ? first(draft.edition) : null;

  return <>
    <Link className="back-link" href="/admin">← Όλα τα βιβλία</Link>
    {messages.saved && <p className="draft-banner">Η επιλογή αποθηκεύτηκε ως πρόχειρη. Έλεγξέ την και δημοσίευσέ την όταν είσαι έτοιμος.</p>}
    {messages.published && <p className="draft-banner">Η έκδοση δημοσιεύτηκε στον κατάλογο.</p>}
    <section className="admin-book-grid">
      <div className="admin-book-cover">{copy.cover_url ? <img src={copy.cover_url} alt="" /> : <div className="missing-cover">Χωρίς εξώφυλλο</div>}</div>
      <div className="admin-book-meta">
        <p className="eyebrow">{copy.legacy_id}</p><h2>{work?.title}</h2><p>{work?.author}</p>
        <dl><dt>Κατηγορία</dt><dd>{copy.category}</dd><dt>Γλώσσα</dt><dd>{copy.language}</dd><dt>Δημοσιευμένο ISBN</dt><dd>{edition?.isbn13 ?? "—"}</dd></dl>
        {draft && <div className="draft-banner"><strong>Πρόχειρη έκδοση</strong><p>{draftEdition?.title ?? work?.title} · {draftEdition?.isbn13}</p><div className="publish-actions">
          <form action={publishEditionDraft}><input type="hidden" name="copyId" value={copy.id} /><input type="hidden" name="legacyId" value={copy.legacy_id} /><button className="primary-button" type="submit">Δημοσίευση</button></form>
          <form action={discardEditionDraft}><input type="hidden" name="copyId" value={copy.id} /><input type="hidden" name="legacyId" value={copy.legacy_id} /><button className="danger-button" type="submit">Απόρριψη πρόχειρου</button></form>
        </div></div>}
      </div>
    </section>
    <h2>Πιθανές εκδόσεις</h2>
    {!candidates.length ? <p className="empty-admin">Δεν υπάρχουν ακόμη υποψήφιες εκδόσεις.</p> :
      <div className="candidate-grid">{candidates.map((candidate) => <article className={"candidate-card " + (candidate.suggested ? "suggested" : "")} key={candidate.id}>
        <div>{candidate.cover_url ? <img src={candidate.cover_url} alt="" loading="lazy" /> : <div className="missing-cover">Χωρίς εξώφυλλο</div>}</div>
        <div>{candidate.suggested && <span className="edition-suggested">Προτεινόμενη</span>}<h3>{candidate.title ?? work?.title}</h3><p>{candidate.publishers.join(", ") || "Άγνωστος εκδότης"}</p><p>{candidate.published_date}</p><code>{candidate.isbn13}</code>
          <form action={saveEditionDraft}><input type="hidden" name="candidateId" value={candidate.id} /><input type="hidden" name="copyId" value={copy.id} /><input type="hidden" name="legacyId" value={copy.legacy_id} /><button className="secondary-button" type="submit">Επιλογή ως πρόχειρο</button></form>
        </div>
      </article>)}</div>}
  </>;
}
