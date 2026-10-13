alter table public.edition_candidates
  add column provider_identifiers jsonb not null default '{}',
  add column work_confidence numeric(5,4),
  add column edition_confidence numeric(5,4),
  add column cover_confidence numeric(5,4),
  add column auto_accept boolean not null default false,
  add constraint candidate_work_confidence_check check (work_confidence is null or work_confidence between 0 and 1),
  add constraint candidate_edition_confidence_check check (edition_confidence is null or edition_confidence between 0 and 1),
  add constraint candidate_cover_confidence_check check (cover_confidence is null or cover_confidence between 0 and 1);

with ranked as (
  select id, score, lead(score) over (partition by copy_id order by rank, score desc, isbn13) as runner_up
  from public.edition_candidates
)
update public.edition_candidates candidate
set work_confidence = least(1, greatest(0, coalesce((candidate.score_breakdown->>'title')::numeric / 500, 0))),
    edition_confidence = candidate.confidence,
    auto_accept = candidate.score >= 500 and candidate.score - coalesce(ranked.runner_up, 0) >= 50
from ranked where ranked.id = candidate.id and candidate.rank = 1;

create table public.cover_assets (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  source_type text not null check (source_type in ('isbn', 'metadata', 'owner_upload', 'source_page', 'legacy')),
  source_url text not null,
  source_page_url text,
  provider text,
  provider_record_id text,
  isbn13 text,
  provider_identifiers jsonb not null default '{}',
  evidence jsonb not null default '[]',
  work_confidence numeric(5,4),
  edition_confidence numeric(5,4),
  cover_confidence numeric(5,4),
  verification_status text not null default 'provisional' check (verification_status in ('provisional', 'algorithm_verified', 'owner_verified', 'owner_rejected')),
  storage_policy text not null default 'reference' check (storage_policy in ('reference', 'retained')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cover_asset_work_confidence_check check (work_confidence is null or work_confidence between 0 and 1),
  constraint cover_asset_edition_confidence_check check (edition_confidence is null or edition_confidence between 0 and 1),
  constraint cover_asset_cover_confidence_check check (cover_confidence is null or cover_confidence between 0 and 1)
);

create table public.copy_cover_selections (
  copy_id uuid primary key references public.copies(id) on delete cascade,
  cover_asset_id uuid not null references public.cover_assets(id) on delete restrict,
  usage_scope text not null check (usage_scope in ('exact_edition', 'representative')),
  decision_source text not null check (decision_source in ('algorithm', 'owner')),
  selected_by uuid references auth.users(id) on delete set null,
  selected_at timestamptz not null default now()
);

create index cover_assets_isbn_idx on public.cover_assets(isbn13) where isbn13 is not null;
alter table public.cover_assets enable row level security;
alter table public.copy_cover_selections enable row level security;
grant select on public.cover_assets to anon, authenticated;
grant select on public.copy_cover_selections to authenticated;
create policy "Public reads cover assets" on public.cover_assets for select using (true);
create policy "Owners read cover selections" on public.copy_cover_selections for select to authenticated
using (exists (select 1 from public.copies where copies.id = copy_cover_selections.copy_id and public.owns_collection(copies.collection_id)));

create function private.sync_cover_asset_selection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare target_asset_id uuid;
begin
  if new.cover_url is null or new.cover_url !~ '^/api/cover-assets/[0-9a-f-]{36}$' then return new; end if;
  target_asset_id := substring(new.cover_url from '/api/cover-assets/([0-9a-f-]{36})$')::uuid;
  if not exists(select 1 from public.cover_assets where id = target_asset_id) then return new; end if;
  insert into public.copy_cover_selections(copy_id, cover_asset_id, usage_scope, decision_source, selected_by, selected_at)
  values(new.id, target_asset_id, case when new.edition_id is null then 'representative' else 'exact_edition' end, case when new.edition_confirmed_by is null then 'algorithm' else 'owner' end, new.edition_confirmed_by, now())
  on conflict(copy_id) do update set cover_asset_id = excluded.cover_asset_id, usage_scope = excluded.usage_scope, decision_source = excluded.decision_source, selected_by = excluded.selected_by, selected_at = now();
  return new;
end;
$$;

create trigger sync_cover_asset_selection_after_copy_update
after insert or update of cover_url, edition_id, edition_confirmed_by on public.copies
for each row execute function private.sync_cover_asset_selection();

create or replace function private.select_isbn_cover_asset(
  target_copy_id uuid,
  target_isbn text,
  target_provider text,
  target_provider_id text,
  target_provider_identifiers jsonb,
  target_evidence jsonb,
  target_work_confidence numeric,
  target_edition_confidence numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare target_asset_id uuid;
begin
  insert into public.cover_assets(canonical_key, source_type, source_url, provider, provider_record_id, isbn13, provider_identifiers, evidence, work_confidence, edition_confidence, cover_confidence, verification_status)
  values('isbn:' || target_isbn, 'isbn', '/api/covers/' || target_isbn, target_provider, target_provider_id, target_isbn, coalesce(target_provider_identifiers, '{}'), coalesce(target_evidence, '[]'), target_work_confidence, target_edition_confidence, target_edition_confidence, 'algorithm_verified')
  on conflict(canonical_key) do update set
    provider = coalesce(excluded.provider, cover_assets.provider),
    provider_record_id = coalesce(excluded.provider_record_id, cover_assets.provider_record_id),
    provider_identifiers = cover_assets.provider_identifiers || excluded.provider_identifiers,
    evidence = excluded.evidence,
    work_confidence = greatest(cover_assets.work_confidence, excluded.work_confidence),
    edition_confidence = greatest(cover_assets.edition_confidence, excluded.edition_confidence),
    cover_confidence = greatest(cover_assets.cover_confidence, excluded.cover_confidence),
    updated_at = now()
  returning id into target_asset_id;

  insert into public.copy_cover_selections(copy_id, cover_asset_id, usage_scope, decision_source)
  values(target_copy_id, target_asset_id, 'exact_edition', 'algorithm')
  on conflict(copy_id) do update set cover_asset_id = excluded.cover_asset_id, usage_scope = excluded.usage_scope, decision_source = excluded.decision_source, selected_by = null, selected_at = now();
  return target_asset_id;
end;
$$;

create or replace function public.apply_best_isbn_candidate(target_copy_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  copy_state text;
  best public.edition_candidates%rowtype;
  target_edition_id uuid;
  target_asset_id uuid;
begin
  select edition_verification_state into copy_state from public.copies where id = target_copy_id for update;
  if not found or copy_state in ('owner_confirmed', 'owner_overridden', 'no_isbn') then return; end if;

  select * into best
  from public.edition_candidates
  where copy_id = target_copy_id and selection_state <> 'owner_rejected' and provider <> 'manual' and auto_accept
  order by rank, score desc, isbn13, provider, provider_id
  limit 1;
  if not found then return; end if;

  insert into public.editions(isbn13, title, publishers, published_date, cover_url, provider, provider_id, metadata, metadata_status, updated_at)
  values(best.isbn13, best.title, best.publishers, best.published_date, '/api/covers/' || best.isbn13, best.provider, best.provider_id, jsonb_build_object('evidence', best.evidence, 'algorithmVersion', best.algorithm_version, 'providerIdentifiers', best.provider_identifiers, 'workConfidence', best.work_confidence, 'editionConfidence', best.edition_confidence), 'algorithm_selected', now())
  on conflict(isbn13) do update set
    title = coalesce(public.editions.title, excluded.title),
    publishers = case when cardinality(public.editions.publishers) = 0 then excluded.publishers else public.editions.publishers end,
    published_date = coalesce(public.editions.published_date, excluded.published_date),
    cover_url = coalesce(public.editions.cover_url, excluded.cover_url),
    metadata = public.editions.metadata || excluded.metadata,
    updated_at = now()
  returning id into target_edition_id;

  target_asset_id := private.select_isbn_cover_asset(target_copy_id, best.isbn13, best.provider, best.provider_id, best.provider_identifiers, best.evidence, best.work_confidence, best.edition_confidence);
  update public.edition_candidates set selection_state = 'alternative' where copy_id = target_copy_id and selection_state <> 'owner_rejected';
  update public.edition_candidates set selection_state = 'algorithm_selected' where id = best.id;
  update public.copies set edition_id = target_edition_id, cover_url = '/api/cover-assets/' || target_asset_id, cover_source = 'cover-asset', edition_verification_state = 'algorithm_selected', edition_confirmed_by = null, edition_confirmed_at = null, updated_at = now() where id = target_copy_id;
end;
$$;

revoke all on function private.select_isbn_cover_asset(uuid,text,text,text,jsonb,jsonb,numeric,numeric) from public, anon, authenticated;
revoke all on function public.apply_best_isbn_candidate(uuid) from public, anon, authenticated;

create function public.prepare_candidate_cover_asset(target_candidate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare candidate public.edition_candidates%rowtype; target_asset_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select ec.* into candidate from public.edition_candidates ec join public.copies c on c.id = ec.copy_id
  where ec.id = target_candidate_id and public.owns_collection(c.collection_id);
  if not found then raise exception 'Candidate not found.'; end if;
  insert into public.cover_assets(canonical_key, source_type, source_url, provider, provider_record_id, isbn13, provider_identifiers, evidence, work_confidence, edition_confidence, cover_confidence, verification_status)
  values('isbn:' || candidate.isbn13, 'isbn', '/api/covers/' || candidate.isbn13, candidate.provider, candidate.provider_id, candidate.isbn13, candidate.provider_identifiers, candidate.evidence, candidate.work_confidence, candidate.edition_confidence, candidate.cover_confidence, 'owner_verified')
  on conflict(canonical_key) do update set verification_status = 'owner_verified', provider_identifiers = cover_assets.provider_identifiers || excluded.provider_identifiers, updated_at = now()
  returning id into target_asset_id;
  return target_asset_id;
end;
$$;

revoke all on function public.prepare_candidate_cover_asset(uuid) from public, anon;
grant execute on function public.prepare_candidate_cover_asset(uuid) to authenticated;

insert into public.cover_assets(canonical_key, source_type, source_url, provider, isbn13, verification_status)
select distinct 'isbn:' || e.isbn13, 'isbn', '/api/covers/' || e.isbn13, coalesce(e.provider, 'isbn-resolver'), e.isbn13, 'algorithm_verified'
from public.copies c join public.editions e on e.id = c.edition_id where e.isbn13 is not null
on conflict(canonical_key) do nothing;

insert into public.cover_assets(canonical_key, source_type, source_url, provider, verification_status)
select 'copy:' || c.id || ':existing', case when c.cover_source = 'metadata-resolver' then 'metadata' else 'legacy' end, c.cover_url, c.cover_source, 'provisional'
from public.copies c where c.cover_url is not null
on conflict(canonical_key) do nothing;

insert into public.copy_cover_selections(copy_id, cover_asset_id, usage_scope, decision_source)
select c.id, a.id, case when c.edition_id is null then 'representative' else 'exact_edition' end, 'algorithm'
from public.copies c join public.cover_assets a on a.canonical_key = 'copy:' || c.id || ':existing'
on conflict(copy_id) do nothing;

insert into public.copy_cover_selections(copy_id, cover_asset_id, usage_scope, decision_source)
select c.id, a.id, 'exact_edition', case when c.edition_verification_state in ('owner_confirmed','owner_overridden') then 'owner' else 'algorithm' end
from public.copies c join public.editions e on e.id = c.edition_id join public.cover_assets a on a.canonical_key = 'isbn:' || e.isbn13
on conflict(copy_id) do update set cover_asset_id = excluded.cover_asset_id, usage_scope = excluded.usage_scope, decision_source = excluded.decision_source;

update public.copies c set cover_url = '/api/cover-assets/' || selection.cover_asset_id, cover_source = 'cover-asset', updated_at = now()
from public.copy_cover_selections selection where selection.copy_id = c.id;

create function public.reject_edition_candidate(target_candidate_id uuid, rejection_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare candidate public.edition_candidates%rowtype; copy_row public.copies%rowtype; selected_isbn text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into candidate from public.edition_candidates where id = target_candidate_id for update;
  if not found then raise exception 'Candidate not found.'; end if;
  select * into copy_row from public.copies where id = candidate.copy_id and public.owns_collection(collection_id) for update;
  if not found then raise exception 'Candidate not found.'; end if;

  select isbn13 into selected_isbn from public.editions where id = copy_row.edition_id;
  update public.edition_candidates set selection_state = 'owner_rejected', auto_accept = false where id = candidate.id;
  insert into public.candidate_feedback(copy_id, candidate_id, actor_id, action, reason, replacement_isbn13, algorithm_version, evidence_snapshot)
  values(candidate.copy_id, candidate.id, auth.uid(), 'rejected', nullif(btrim(rejection_reason), ''), candidate.isbn13, candidate.algorithm_version, candidate.evidence);

  if copy_row.edition_verification_state = 'algorithm_selected' and selected_isbn = candidate.isbn13 then
    delete from public.copy_cover_selections where copy_id = candidate.copy_id and decision_source = 'algorithm';
    update public.copies set edition_id = null, cover_url = null, cover_source = null, edition_verification_state = 'unresolved', updated_at = now() where id = candidate.copy_id;
    perform public.apply_best_isbn_candidate(candidate.copy_id);
  end if;
end;
$$;

revoke all on function public.reject_edition_candidate(uuid,text) from public, anon;
grant execute on function public.reject_edition_candidate(uuid,text) to authenticated;
