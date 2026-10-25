import { getTranslations } from "@/lib/i18n/server";
import { DEFAULT_BOOK_COVER } from "@/lib/book-cover";
import { BookLoanEditor } from "@/components/book-loan-editor";
import { categoryTags } from "@/lib/category-tags";
import type { BookLoan } from "@/lib/book-loan";
import { BookCoverImage } from "@/components/book-cover-image";
import { CoverUploadForm } from "@/components/cover-upload-form";
import { IsbnCandidateSearchForm } from "@/components/isbn-candidate-search-form";
import type { IsbnEditionMetadata } from "@/lib/isbn-edition";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/catalogue-viewer";
import { Suspense } from "react";
import { discardEditionDraft, publishEditionDraft, rejectEditionCandidate, saveEditionDraft, saveManualIsbnDraft } from "@/app/admin/actions";

type Relation<T> = T | T[] | null;
type Work = { title: string; author: string };
type Edition = { isbn13: string | null; title: string | null; publishers: string[]; published_date: string | null; cover_url: string | null };
type Draft = { edition_metadata: Partial<IsbnEditionMetadata>; edition_id: string; cover_url: string | null; edition: Relation<Edition> };
type Copy = { loan: Relation<{ status: BookLoan["status"]; person_name: string | null }>; id: string; legacy_id: string; category: string; categories: string[]; language: string; publisher: string | null; cover_url: string | null; cover_status: string; owner_cover_path: string | null; edition_verification_state: string; last_isbn_candidate_search_at: string | null; last_isbn_search_provider_failures: number | null; work: Relation<Work>; edition: Relation<Edition>; copy_drafts: Relation<Draft>; collection: Relation<{ id: string; name: string }> };
type Candidate = { id: string; isbn13: string; title: string | null; publishers: string[]; published_date: string | null; cover_url: string | null; provider: string; score: number; suggested: boolean; rank: number; selection_state: string; confidence: number | null; work_confidence: number | null; edition_confidence: number | null; cover_confidence: number | null; auto_accept: boolean; review_only: boolean; manual_search_rank: number | null; algorithm_version: string };

function first<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function CollectionBookEditPage({ params, searchParams }: {
  params: Promise<{ slug: string; legacyId: string }>;
  searchParams: Promise<{ saved?: string; published?: string; rejected?: string; error?: string; coverSaved?: string; isbnSearched?: string }>;
}) {
  const t = await getTranslations();
  const { slug, legacyId } = await params;
  const messages = await searchParams;
  const supabase = await createSupabaseServerClient();
  const user = await getViewer();
  if (!user) redirect("/login");
  const { data, error } = await supabase.from("copies").select(
    "id,legacy_id,category,categories,language,publisher,cover_url,cover_status,owner_cover_path,edition_verification_state,last_isbn_candidate_search_at,last_isbn_search_provider_failures,collection:collections!inner(id,name),work:works(title,author),edition:editions(isbn13,title,publishers,published_date,cover_url),copy_drafts(edition_id,edition_metadata,cover_url,edition:editions(isbn13,title,publishers,published_date,cover_url)),loan:book_loans(status,person_name)"
  ).eq("collection.slug", slug).eq("collection.owner_id", user.id).eq("legacy_id", legacyId).single();
  if (error || !data) notFound();
  const copy = data as Copy;
  const collection = first(copy.collection);
  if (!collection) notFound();
  const work = first(copy.work);
  const loan = first(copy.loan);
  const edition = first(copy.edition);
  const draft = first(copy.copy_drafts);
  const draftEdition = draft ? first(draft.edition) : null;
  const draftDetails = draft?.edition_metadata;
  const previewTitle = draft ? draftDetails?.title ?? draftEdition?.title ?? work?.title : work?.title;
  const previewAuthor = draftDetails?.authors?.length ? draftDetails.authors.join(", ") : work?.author;
  const previewPublisher = draft ? (draftDetails?.publishers?.length ? draftDetails.publishers.join(", ") : draftEdition?.publishers.join(", ")) || copy.publisher : edition?.publishers.join(", ") || copy.publisher;
  const previewLanguage = draftDetails?.language ?? copy.language;
  const previewDate = draft ? draftDetails?.publishedDate ?? draftEdition?.published_date : edition?.published_date;
  const cover = copy.owner_cover_path ? copy.cover_url : draft
    ? draft.cover_url ?? draftEdition?.cover_url ?? (draftEdition?.isbn13 ? "/api/covers/" + draftEdition.isbn13 : DEFAULT_BOOK_COVER)
    : copy.cover_status === "cover_not_found" ? DEFAULT_BOOK_COVER : copy.cover_url;

  return <main className="admin-shell">
    <header className="admin-header"><div><p className="eyebrow">{t("EDIT COLLECTION")}</p><h1>{collection.name}</h1></div><nav><Link href={`/collections/${slug}#book-${encodeURIComponent(legacyId)}`}>{t("Back to collection")}</Link></nav></header>
    {messages.error && <p className="form-error">{t(messages.error)}</p>}
    {messages.coverSaved && <p className="auth-notice" role="status">{t("Your cover image has been saved.")}</p>}
    {messages.saved && <p className="draft-banner">{t("Your selection was saved as a draft. Review it and publish when ready.")}</p>}
    {messages.published && <p className="draft-banner">{t("The edition was published to the collection.")}</p>}
    {messages.rejected && <p className="draft-banner">{t("The candidate edition was rejected and will not be suggested again for this copy.")}</p>}
    <section className="admin-book-grid">
      <div className="admin-book-cover"><BookCoverImage src={cover} alt="" fallbackAlt={t("Cover unavailable")} /></div>
      <div className="admin-book-meta"><p className="eyebrow">{copy.legacy_id}</p><h2>{previewTitle}</h2><p>{previewAuthor}</p><dl><dt>{t("Category tags")}</dt><dd><ul className="category-tags">{categoryTags(copy.categories,copy.category).map(tag => <li key={tag}>{tag}</li>)}</ul></dd><dt>{t("Language")}</dt><dd>{draft ? previewLanguage : copy.language}</dd><dt>{t("Publisher")}</dt><dd>{previewPublisher || "—"}</dd><dt>{t("Publication date")}</dt><dd>{previewDate ?? "—"}</dd><dt>{t("Published ISBN")}</dt><dd>{edition?.isbn13 ?? "—"}</dd><dt>{t("Matching status")}</dt><dd>{copy.edition_verification_state === "algorithm_selected" ? t("Automatic selection") : copy.edition_verification_state === "owner_overridden" ? t("Owner correction") : t(({ owner_confirmed: "Owner confirmed", no_isbn: "No ISBN", unresolved: "Unresolved" } as Record<string, string>)[copy.edition_verification_state] ?? copy.edition_verification_state)}</dd></dl>
        {draft && <div className="draft-banner"><strong>{t("Draft edition")}</strong><p>{previewTitle} · {draftEdition?.isbn13}</p><p>{t("Preview of the cover and details that will be applied when you publish.")}</p>{copy.owner_cover_path && <p>{t("Your uploaded cover will be kept.")}</p>}{(!draftDetails?.title || !draftDetails?.authors?.length) && <p>{t("Some ISBN details are unavailable. Existing details will be kept where needed.")}</p>}<div className="publish-actions">
          <form action={publishEditionDraft}><input type="hidden" name="copyId" value={copy.id} /><input type="hidden" name="legacyId" value={copy.legacy_id} /><input type="hidden" name="collectionSlug" value={slug} /><button className="primary-button" type="submit">{t("Publish")}</button></form>
          <form action={discardEditionDraft}><input type="hidden" name="copyId" value={copy.id} /><input type="hidden" name="legacyId" value={copy.legacy_id} /><input type="hidden" name="collectionSlug" value={slug} /><button className="danger-button" type="submit">{t("Discard draft")}</button></form>
        </div></div>}
      </div>
    </section>
    <BookLoanEditor slug={slug} legacyId={copy.legacy_id} loan={loan ? { status: loan.status,personName: loan.person_name } : null} />
    <CoverUploadForm copyId={copy.id} legacyId={copy.legacy_id} collectionSlug={slug} />
    <section className="manual-isbn"><h2>{t("Enter ISBN manually")}</h2><p>{t("Enter the ISBN-10 or ISBN-13 printed on the book. It will be converted and validated before being saved as a draft.")}</p><form action={saveManualIsbnDraft} className="manual-isbn-row"><input type="hidden" name="copyId" value={copy.id} /><input type="hidden" name="legacyId" value={copy.legacy_id} /><input type="hidden" name="collectionSlug" value={slug} /><label className="sr-only" htmlFor="manual-isbn">ISBN</label><input id="manual-isbn" name="isbn" inputMode="numeric" autoComplete="off" placeholder="978…" required /><button className="primary-button" type="submit">{t("Save ISBN")}</button></form></section>
    <IsbnCandidateSearchForm copyId={copy.id} legacyId={copy.legacy_id} collectionSlug={slug} />
    <Suspense fallback={<section aria-busy="true"><h2>{t("Possible editions")}</h2><p role="status">{t("Loading possible editions…")}</p></section>}>
      <CandidateEditions copy={copy} slug={slug} searched={Boolean(messages.isbnSearched)} />
    </Suspense>
  </main>;
}

// This private read runs only after the parent has verified collection ownership.
// Keeping it behind Suspense lets the editor stream without waiting for candidates.
async function CandidateEditions({ copy, slug, searched }: { copy: Copy; slug: string; searched: boolean }) {
  const t = await getTranslations();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("edition_candidates").select(
    "id,isbn13,title,publishers,published_date,cover_url,provider,score,suggested,rank,selection_state,confidence,work_confidence,edition_confidence,cover_confidence,auto_accept,review_only,manual_search_rank,algorithm_version"
  ).eq("copy_id", copy.id).order("rank");
  if (error) return <section><h2>{t("Possible editions")}</h2><p role="alert">{t("Possible editions could not be loaded. Reload the page to try again.")}</p></section>;
  const allCandidates = (data ?? []) as Candidate[];
  const candidates = copy.last_isbn_candidate_search_at
    ? allCandidates.filter(candidate => typeof candidate.manual_search_rank === "number")
      .sort((left, right) => left.manual_search_rank! - right.manual_search_rank!)
    : allCandidates;
  const work = first(copy.work);
  return <section>
    {searched && <p className="auth-notice" role="status">{candidates.length ? t("Found {0} ISBN candidates. Choose an edition to use it.", [candidates.length]) : t("No ISBNs were matched.")}</p>}
    {candidates.length > 0 && (copy.last_isbn_search_provider_failures ?? 0) > 0 && <p className="auth-notice" role="status">{t("Some ISBN providers were unavailable. These results may be incomplete; you can search again.")}</p>}
    <h2>{t("Possible editions")}</h2>
    {!candidates.length ? <p className="empty-admin">{t(copy.last_isbn_candidate_search_at ? "No ISBNs were matched." : "No candidate editions yet.")}</p> : <div className="candidate-grid">{candidates.map((candidate) => <article className={"candidate-card " + (candidate.selection_state !== "alternative" ? "suggested" : "")} key={candidate.id}><div><BookCoverImage src={candidate.cover_url} alt="" fallbackAlt={t("Cover unavailable")} loading="lazy" /></div><div><p className="eyebrow">{t("Rank {0}", [candidate.manual_search_rank ?? candidate.rank])}</p>{candidate.selection_state === "algorithm_selected" && <span className="edition-suggested">{t(candidate.review_only ? "Current edition" : "Automatic selection")}</span>}{candidate.selection_state === "owner_selected" && <span className="edition-suggested">{t("Owner's choice")}</span>}{candidate.selection_state === "owner_rejected" && <span className="edition-suggested">{t("Rejected")}</span>}<h3>{candidate.title ?? work?.title}</h3><p>{candidate.publishers.join(", ") || t("Unknown publisher")}</p><p>{candidate.published_date}</p><p>{t("Work") + " "}{candidate.work_confidence === null ? "—" : `${Math.round(candidate.work_confidence * 100)}%`} {" " + t("· Edition") + " "}{candidate.edition_confidence === null ? "—" : `${Math.round(candidate.edition_confidence * 100)}%`} {" " + t("· Cover") + " "}{candidate.cover_confidence === null ? t("unverified") : `${Math.round(candidate.cover_confidence * 100)}%`}</p><p>{!candidate.review_only && candidate.auto_accept ? t("Meets the automatic acceptance threshold") : t("Requires owner's selection")}</p><code>{candidate.isbn13}</code><div className="publish-actions"><form action={saveEditionDraft}><input type="hidden" name="candidateId" value={candidate.id} /><input type="hidden" name="copyId" value={copy.id} /><input type="hidden" name="legacyId" value={copy.legacy_id} /><input type="hidden" name="collectionSlug" value={slug} /><button className="secondary-button" type="submit">{t("This is my copy")}</button></form>{candidate.selection_state !== "owner_rejected" && <form action={rejectEditionCandidate}><input type="hidden" name="candidateId" value={candidate.id} /><input type="hidden" name="legacyId" value={copy.legacy_id} /><input type="hidden" name="collectionSlug" value={slug} /><button className="danger-button" type="submit">{t("Reject")}</button></form>}</div></div></article>)}</div>}
  </section>;
}
