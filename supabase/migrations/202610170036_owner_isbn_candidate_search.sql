-- Owner-triggered ISBN discovery is a candidate-only operation.
alter table public.edition_candidates
  add column review_only boolean not null default false,
  add column manual_search_rank integer;
alter table public.copies
  add column last_isbn_candidate_search_at timestamptz,
  add column last_isbn_search_provider_failures integer;

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
  where copy_id = target_copy_id and selection_state <> 'owner_rejected' and provider <> 'manual' and auto_accept and not review_only
  order by rank, score desc, isbn13, provider, provider_id
  limit 1;
  if not found then return; end if;

  insert into public.editions(isbn13, title, publishers, published_date, provider, provider_id, metadata, metadata_status, updated_at)
  values(best.isbn13, best.title, best.publishers, best.published_date, best.provider, best.provider_id, jsonb_build_object('evidence', best.evidence, 'algorithmVersion', best.algorithm_version, 'providerIdentifiers', best.provider_identifiers, 'workConfidence', best.work_confidence, 'editionConfidence', best.edition_confidence), 'algorithm_selected', now())
  on conflict(isbn13) do update set
    title = coalesce(public.editions.title, excluded.title),
    publishers = case when cardinality(public.editions.publishers) = 0 then excluded.publishers else public.editions.publishers end,
    published_date = coalesce(public.editions.published_date, excluded.published_date),
    metadata = public.editions.metadata || excluded.metadata,
    updated_at = now()
  returning id into target_edition_id;

  update public.edition_candidates set selection_state = 'alternative' where copy_id = target_copy_id and selection_state <> 'owner_rejected';
  update public.edition_candidates set selection_state = 'algorithm_selected' where id = best.id;
  update public.copies set edition_id = target_edition_id, edition_verification_state = 'algorithm_selected', edition_confirmed_by = null, edition_confirmed_at = null, updated_at = now() where id = target_copy_id;
end;
$$;


create or replace function public.auto_select_isbn_candidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.review_only and new.provider <> 'manual' and new.selection_state not in ('owner_selected', 'owner_rejected') then
    perform public.apply_best_isbn_candidate(new.copy_id);
  end if;
  return new;
end;
$$;

create or replace function private.mark_visible_isbn_auto_accept()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.review_only then
    new.auto_accept := false;
    return new;
  end if;
  if new.provider in ('manual-visible-isbn', 'chatgpt-visible-isbn') then
    new.auto_accept := true;
    new.work_confidence := coalesce(new.work_confidence, new.confidence);
    new.edition_confidence := coalesce(new.edition_confidence, new.confidence, 1);
  end if;
  return new;
end;
$$;

create function public.save_book_isbn_search(target_copy_id uuid, candidates jsonb, provider_failures integer default 0)
returns integer language plpgsql security definer set search_path = public as $$
declare candidate jsonb; search_rank integer := 0; saved_count integer := 0;
begin
  perform 1 from public.copies c where c.id = target_copy_id
    and public.owns_collection(c.collection_id) for update;
  if not found or auth.uid() is null then raise exception 'Collection ownership required.'; end if;
  if jsonb_typeof(candidates) <> 'array' or jsonb_array_length(candidates) > 10
    or provider_failures not between 0 and 2 then raise exception 'Invalid ISBN search results.'; end if;
  if exists(select 1 from jsonb_array_elements(candidates) item
    where coalesce(item->>'isbn13','') !~ '^97[89][0-9]{10}$') then
    raise exception 'Invalid ISBN candidate.';
  end if;

  -- Neither changing this metadata nor clearing old search ranks fires matching.
  update public.edition_candidates set manual_search_rank = null where copy_id = target_copy_id;
  delete from public.edition_candidates where copy_id = target_copy_id
    and provider = 'owner-isbn-search-v3' and selection_state = 'alternative';

  for candidate in select value from jsonb_array_elements(candidates) loop
    if exists(select 1 from public.edition_candidates where copy_id = target_copy_id
      and isbn13 = candidate->>'isbn13' and selection_state = 'owner_rejected')
      or exists(select 1 from public.candidate_feedback where copy_id = target_copy_id
        and action = 'rejected' and replacement_isbn13 = candidate->>'isbn13') then
      continue;
    end if;
    search_rank := search_rank + 1;
    insert into public.edition_candidates as existing (
      copy_id, isbn13, title, publishers, published_date, provider, provider_id,
      score, suggested, rank, evidence, selection_state, confidence, algorithm_version,
      score_breakdown, provider_count, provider_identifiers, work_confidence,
      edition_confidence, auto_accept, review_only, manual_search_rank, last_evaluated_at
    ) values (
      target_copy_id, candidate->>'isbn13', candidate->>'title',
      array(select jsonb_array_elements_text(coalesce(candidate->'publishers','[]'))),
      candidate->>'publishedDate', 'owner-isbn-search-v3', coalesce(candidate->>'providerId',candidate->>'isbn13'),
      (candidate->>'score')::integer, search_rank = 1, search_rank,
      coalesce(candidate->'evidence','[]'), 'alternative', (candidate->>'confidence')::numeric,
      'isbn-ranker-v3', coalesce(candidate->'scoreBreakdown','{}'), (candidate->>'providerCount')::integer,
      coalesce(candidate->'providerIdentifiers','{}'), (candidate->>'workConfidence')::numeric,
      (candidate->>'editionConfidence')::numeric, false, true, search_rank, now()
    ) on conflict(copy_id,isbn13) do update set
      title = excluded.title, publishers = excluded.publishers, published_date = excluded.published_date,
      provider = case when existing.selection_state = 'alternative' then excluded.provider else existing.provider end,
      provider_id = case when existing.selection_state = 'alternative' then excluded.provider_id else existing.provider_id end,
      score = excluded.score, suggested = excluded.suggested, rank = excluded.rank,
      evidence = excluded.evidence, confidence = excluded.confidence, algorithm_version = excluded.algorithm_version,
      score_breakdown = excluded.score_breakdown, provider_count = excluded.provider_count,
      provider_identifiers = excluded.provider_identifiers, work_confidence = excluded.work_confidence,
      edition_confidence = excluded.edition_confidence, auto_accept = false,
      review_only = true, manual_search_rank = search_rank, last_evaluated_at = now();
    saved_count := saved_count + 1;
  end loop;
  update public.copies set last_isbn_candidate_search_at = now(),
    last_isbn_search_provider_failures = provider_failures where id = target_copy_id;
  return saved_count;
end;
$$;
revoke all on function public.save_book_isbn_search(uuid,jsonb,integer) from public, anon;
grant execute on function public.save_book_isbn_search(uuid,jsonb,integer) to authenticated;

