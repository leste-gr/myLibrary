alter table public.works
  add column normalized_title text,
  add column normalized_author text;

update public.works
set normalized_title = lower(regexp_replace(title, '[^[:alnum:]]+', ' ', 'g')),
    normalized_author = lower(regexp_replace(author, '[^[:alnum:]]+', ' ', 'g'));

alter table public.editions
  add column isbn10 text,
  add column metadata_status text not null default 'provider_supplied',
  add column metadata_confirmed_at timestamptz,
  add constraint isbn10_format check (isbn10 is null or isbn10 ~ '^[0-9]{9}[0-9X]$'),
  add constraint edition_metadata_status_check check (metadata_status in ('provider_supplied', 'algorithm_selected', 'owner_confirmed', 'owner_overridden', 'manual'));

alter table public.copies
  add column edition_verification_state text not null default 'unresolved',
  add column edition_confirmed_by uuid references auth.users(id) on delete set null,
  add column edition_confirmed_at timestamptz,
  add constraint copy_edition_verification_state_check check (edition_verification_state in ('unresolved', 'algorithm_selected', 'owner_confirmed', 'owner_overridden', 'no_isbn'));

alter table public.edition_candidates
  add column selection_state text not null default 'alternative',
  add column confidence numeric(5,4),
  add column algorithm_version text not null default 'isbn-ranker-v1',
  add column score_breakdown jsonb not null default '{}',
  add column provider_count integer not null default 1,
  add column last_evaluated_at timestamptz not null default now(),
  add constraint candidate_selection_state_check check (selection_state in ('algorithm_selected', 'alternative', 'owner_selected', 'owner_rejected')),
  add constraint candidate_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add constraint candidate_provider_count_check check (provider_count > 0);

create table public.book_observations (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  copy_id uuid references public.copies(id) on delete cascade,
  source_type text not null,
  source_asset_url text,
  crop_asset_url text,
  title_text text,
  author_text text,
  publisher_text text,
  isbn_text text,
  language_hint text,
  format_hint text,
  raw_payload jsonb not null default '{}',
  confidence numeric(5,4),
  status text not null default 'ready_for_matching',
  created_at timestamptz not null default now(),
  constraint observation_source_type_check check (source_type in ('shelfie', 'barcode', 'cover_photo', 'copyright_page', 'manual', 'legacy_import')),
  constraint observation_status_check check (status in ('pending', 'ready_for_matching', 'matched', 'unresolved', 'rejected')),
  constraint observation_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create table public.observation_tokens (
  id bigint generated always as identity primary key,
  observation_id uuid not null references public.book_observations(id) on delete cascade,
  text text not null,
  normalized_text text,
  bounding_box jsonb,
  confidence numeric(5,4),
  reading_order integer,
  token_type text not null default 'unknown',
  constraint observation_token_type_check check (token_type in ('title', 'author', 'publisher', 'isbn', 'series', 'unknown')),
  constraint observation_token_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create table public.candidate_evidence (
  id bigint generated always as identity primary key,
  candidate_id uuid not null references public.edition_candidates(id) on delete cascade,
  observation_id uuid references public.book_observations(id) on delete set null,
  evidence_type text not null,
  source_provider text,
  source_record_id text,
  observed_value text,
  candidate_value text,
  similarity numeric(6,5),
  weight integer not null default 0,
  score_contribution integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.provider_records (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_record_id text not null,
  isbn13 text,
  raw_payload jsonb not null,
  normalized_payload jsonb not null default '{}',
  response_status integer,
  payload_checksum text,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  unique(provider, provider_record_id)
);

create index provider_records_isbn13_idx on public.provider_records(isbn13);
create index observations_collection_idx on public.book_observations(collection_id, created_at desc);
create index observation_tokens_observation_idx on public.observation_tokens(observation_id);
create index candidate_evidence_candidate_idx on public.candidate_evidence(candidate_id);

create table public.candidate_feedback (
  id bigint generated always as identity primary key,
  copy_id uuid not null references public.copies(id) on delete cascade,
  candidate_id uuid references public.edition_candidates(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  reason text,
  replacement_isbn13 text,
  algorithm_version text,
  evidence_snapshot jsonb not null default '[]',
  created_at timestamptz not null default now(),
  constraint candidate_feedback_action_check check (action in ('confirmed', 'overridden', 'rejected', 'manual_isbn', 'no_isbn'))
);

alter table public.book_observations enable row level security;
alter table public.observation_tokens enable row level security;
alter table public.candidate_evidence enable row level security;
alter table public.provider_records enable row level security;
alter table public.candidate_feedback enable row level security;

grant select, insert, update, delete on public.book_observations, public.observation_tokens, public.candidate_feedback to authenticated;
grant select on public.candidate_evidence, public.provider_records to authenticated;
grant usage, select on sequence public.observation_tokens_id_seq, public.candidate_evidence_id_seq, public.candidate_feedback_id_seq to authenticated;

create policy "Owners manage their observations" on public.book_observations for all to authenticated
using (public.owns_collection(collection_id)) with check (public.owns_collection(collection_id));

create policy "Owners manage their observation tokens" on public.observation_tokens for all to authenticated
using (exists (select 1 from public.book_observations where book_observations.id = observation_tokens.observation_id and public.owns_collection(book_observations.collection_id)))
with check (exists (select 1 from public.book_observations where book_observations.id = observation_tokens.observation_id and public.owns_collection(book_observations.collection_id)));

create policy "Owners read their candidate evidence" on public.candidate_evidence for select to authenticated
using (exists (select 1 from public.edition_candidates join public.copies on copies.id = edition_candidates.copy_id where edition_candidates.id = candidate_evidence.candidate_id and public.owns_collection(copies.collection_id)));

create policy "Authenticated users read provider cache" on public.provider_records for select to authenticated using (true);

create policy "Owners manage their candidate feedback" on public.candidate_feedback for all to authenticated
using (exists (select 1 from public.copies where copies.id = candidate_feedback.copy_id and public.owns_collection(copies.collection_id)))
with check (actor_id = auth.uid() and exists (select 1 from public.copies where copies.id = candidate_feedback.copy_id and public.owns_collection(copies.collection_id)));

update public.edition_candidates
set score = score
  + case when provider = 'manual' or evidence @> '["manual ISBN entry"]'::jsonb then 1000 else 0 end
  + case when evidence @> '["existing edition-level source"]'::jsonb then 500 else 0 end
  + case when evidence @> '["structured ISBN on existing source page"]'::jsonb then 500 else 0 end,
    score_breakdown = jsonb_build_object(
      'legacy_score', score,
      'manual_isbn', case when provider = 'manual' or evidence @> '["manual ISBN entry"]'::jsonb then 1000 else 0 end,
      'exact_provenance', case when evidence @> '["existing edition-level source"]'::jsonb or evidence @> '["structured ISBN on existing source page"]'::jsonb then 500 else 0 end
    ),
    algorithm_version = 'isbn-ranker-v2',
    last_evaluated_at = now();

with ranked as (
  select id, row_number() over (partition by copy_id order by score desc, isbn13, provider, provider_id) as new_rank
  from public.edition_candidates
)
update public.edition_candidates
set rank = ranked.new_rank
from ranked where ranked.id = edition_candidates.id;

update public.edition_candidates
set confidence = least(1, greatest(0, score::numeric / 500));

insert into public.candidate_evidence(candidate_id, evidence_type, source_provider, source_record_id, weight, score_contribution)
select
  candidate.id,
  evidence.value,
  candidate.provider,
  candidate.provider_id,
  case
    when evidence.value = 'manual ISBN entry' then 1000
    when evidence.value in ('existing edition-level source', 'structured ISBN on existing source page') then 500
    when evidence.value = 'selected cover ID matches edition' then 100
    when evidence.value = 'exact normalized title' then 25
    when evidence.value = 'exact normalized author' then 25
    else 0
  end,
  case
    when evidence.value = 'manual ISBN entry' then 1000
    when evidence.value in ('existing edition-level source', 'structured ISBN on existing source page') then 500
    when evidence.value = 'selected cover ID matches edition' then 100
    when evidence.value = 'exact normalized title' then 25
    when evidence.value = 'exact normalized author' then 25
    else 0
  end
from public.edition_candidates candidate
cross join lateral jsonb_array_elements_text(candidate.evidence) as evidence(value);

update public.copies
set edition_verification_state = 'owner_overridden',
    edition_confirmed_at = coalesce((select max(created_at) from public.audit_events where audit_events.copy_id = copies.id), now()),
    edition_confirmed_by = (select actor_id from public.audit_events where audit_events.copy_id = copies.id order by created_at desc limit 1)
where exists (select 1 from public.audit_events where audit_events.copy_id = copies.id);

update public.edition_candidates as candidate
set selection_state = 'owner_selected'
from public.copies as copy
join public.editions as edition on edition.id = copy.edition_id
where candidate.copy_id = copy.id
  and candidate.isbn13 = edition.isbn13
  and copy.edition_verification_state = 'owner_overridden';

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
begin
  select edition_verification_state into copy_state from public.copies where id = target_copy_id for update;
  if not found or copy_state in ('owner_confirmed', 'owner_overridden', 'no_isbn') then return; end if;

  select * into best
  from public.edition_candidates
  where copy_id = target_copy_id and selection_state <> 'owner_rejected' and provider <> 'manual'
  order by rank, score desc, isbn13, provider, provider_id
  limit 1;
  if not found then return; end if;

  insert into public.editions(isbn13, title, publishers, published_date, cover_url, provider, provider_id, metadata, metadata_status, updated_at)
  values(best.isbn13, best.title, best.publishers, best.published_date, coalesce(best.cover_url, '/api/covers/' || best.isbn13), best.provider, best.provider_id, jsonb_build_object('evidence', best.evidence, 'algorithmVersion', best.algorithm_version), 'algorithm_selected', now())
  on conflict(isbn13) do update set
    title = coalesce(public.editions.title, excluded.title),
    publishers = case when cardinality(public.editions.publishers) = 0 then excluded.publishers else public.editions.publishers end,
    published_date = coalesce(public.editions.published_date, excluded.published_date),
    cover_url = coalesce(public.editions.cover_url, excluded.cover_url),
    updated_at = now()
  returning id into target_edition_id;

  update public.edition_candidates set selection_state = 'alternative' where copy_id = target_copy_id and selection_state <> 'owner_rejected';
  update public.edition_candidates set selection_state = 'algorithm_selected' where id = best.id;
  update public.copies set edition_id = target_edition_id, cover_url = coalesce(best.cover_url, '/api/covers/' || best.isbn13), cover_source = 'isbn-resolver', edition_verification_state = 'algorithm_selected', edition_confirmed_by = null, edition_confirmed_at = null, updated_at = now() where id = target_copy_id;
end;
$$;

create or replace function public.auto_select_isbn_candidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.provider <> 'manual' and new.selection_state not in ('owner_selected', 'owner_rejected') then
    perform public.apply_best_isbn_candidate(new.copy_id);
  end if;
  return new;
end;
$$;

drop trigger if exists auto_select_isbn_candidate_after_write on public.edition_candidates;
create trigger auto_select_isbn_candidate_after_write
after insert or update of rank, score on public.edition_candidates
for each row execute function public.auto_select_isbn_candidate();

do $$
declare candidate_copy_id uuid;
begin
  for candidate_copy_id in select distinct copy_id from public.edition_candidates loop
    perform public.apply_best_isbn_candidate(candidate_copy_id);
  end loop;
end;
$$;

create or replace function public.publish_copy_draft(target_copy_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.copy_drafts%rowtype;
  previous_row jsonb;
  next_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into draft_row from public.copy_drafts where copy_id = target_copy_id and created_by = auth.uid() for update;
  if not found then raise exception 'Draft not found'; end if;

  select jsonb_build_object('edition_id', edition_id, 'cover_url', cover_url, 'verification_state', edition_verification_state) into previous_row from public.copies where id = target_copy_id;
  update public.copies set edition_id = draft_row.edition_id, cover_url = coalesce(draft_row.cover_url, (select cover_url from public.editions where id = draft_row.edition_id), cover_url), cover_source = 'isbn-resolver', edition_verification_state = 'owner_overridden', edition_confirmed_by = auth.uid(), edition_confirmed_at = now(), updated_at = now() where id = target_copy_id;
  update public.edition_candidates set selection_state = 'alternative' where copy_id = target_copy_id and selection_state <> 'owner_rejected';
  update public.edition_candidates set selection_state = 'owner_selected' where copy_id = target_copy_id and isbn13 = (select isbn13 from public.editions where id = draft_row.edition_id);
  select jsonb_build_object('edition_id', edition_id, 'cover_url', cover_url, 'verification_state', edition_verification_state) into next_row from public.copies where id = target_copy_id;
  insert into public.audit_events(copy_id, actor_id, action, previous_value, new_value) values(target_copy_id, auth.uid(), 'publish_edition', previous_row, next_row);
  insert into public.candidate_feedback(copy_id, candidate_id, actor_id, action, replacement_isbn13, algorithm_version, evidence_snapshot)
  select target_copy_id, candidate.id, auth.uid(), case when candidate.provider = 'manual' then 'manual_isbn' else 'overridden' end, candidate.isbn13, candidate.algorithm_version, candidate.evidence
  from public.edition_candidates candidate where candidate.copy_id = target_copy_id and candidate.selection_state = 'owner_selected' limit 1;
  delete from public.copy_drafts where copy_id = target_copy_id;
end;
$$;

revoke all on function public.apply_best_isbn_candidate(uuid) from public;
revoke all on function public.auto_select_isbn_candidate() from public;
revoke all on function public.publish_copy_draft(uuid) from public;
grant execute on function public.publish_copy_draft(uuid) to authenticated;
