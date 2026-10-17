-- Edition changes stay private until an owner publishes the draft.
alter table public.edition_candidates add column authors text[] not null default '{}', add column language text;

alter table public.copy_drafts add column edition_metadata jsonb not null default '{}';

create function public.save_owned_isbn_draft(target_copy_id uuid, target_isbn text,
  edition_metadata jsonb, target_candidate_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare target_edition uuid; asset_id uuid;
begin
  if auth.jwt()->>'client_id' is not null then raise exception 'Browser sign-in required.'; end if;
  perform 1 from public.copies where id=target_copy_id and public.owns_collection(collection_id) for update;
  if not found or auth.uid() is null then raise exception 'Collection ownership required.'; end if;
  if target_isbn !~ '^97[89][0-9]{10}$' or jsonb_typeof(edition_metadata) <> 'object' then
    raise exception 'Invalid ISBN draft.';
  end if;
  if target_candidate_id is not null and not exists(select 1 from public.edition_candidates
    where id=target_candidate_id and copy_id=target_copy_id and isbn13=target_isbn) then
    raise exception 'Candidate not found.';
  end if;
  -- Do not rewrite a shared edition's metadata while merely saving a draft.
  insert into public.editions(isbn13,provider,provider_id)
    values(target_isbn,'manual','manual:'||target_isbn)
    on conflict(isbn13) do update set isbn13=excluded.isbn13 returning id into target_edition;
  -- Exact ISBN resolution avoids accidentally previewing another edition's OLID.
  insert into public.cover_assets(canonical_key,source_type,source_url,provider,isbn13,verification_status)
    values('owner-isbn:'||target_isbn,'isbn','/api/covers/'||target_isbn,'owner-isbn',target_isbn,'owner_verified')
    on conflict(canonical_key) do update set source_url=excluded.source_url returning id into asset_id;
  insert into public.copy_drafts(copy_id,edition_id,cover_url,created_by,updated_at,edition_metadata)
    values(target_copy_id,target_edition,'/api/cover-assets/'||asset_id,auth.uid(),now(),
      edition_metadata || jsonb_build_object('selectedCandidateId',target_candidate_id))
    on conflict(copy_id) do update set edition_id=excluded.edition_id,cover_url=excluded.cover_url,
      created_by=excluded.created_by,updated_at=excluded.updated_at,edition_metadata=excluded.edition_metadata;
end;
$$;
revoke all on function public.save_owned_isbn_draft(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.save_owned_isbn_draft(uuid,text,jsonb,uuid) to authenticated;

create or replace function private.publish_copy_draft(target_copy_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  draft_row public.copy_drafts%rowtype;
  copy_row public.copies%rowtype;
  edition_row public.editions%rowtype;
  work_row public.works%rowtype;
  details jsonb;
  next_work uuid;
  next_title text;
  next_author text;
  next_publishers text[];
  previous_row jsonb;
  next_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into copy_row from public.copies where id=target_copy_id
    and public.owns_collection(collection_id) for update;
  if not found then raise exception 'Collection ownership required.'; end if;
  select * into draft_row from public.copy_drafts where copy_id=target_copy_id and created_by=auth.uid() for update;
  if not found then raise exception 'Draft not found'; end if;
  select * into edition_row from public.editions where id=draft_row.edition_id;
  select * into work_row from public.works where id=copy_row.work_id;
  details := edition_row.metadata || draft_row.edition_metadata;
  next_title := coalesce(nullif(details->>'title',''),edition_row.title,work_row.title);
  select string_agg(value,', ' order by position) into next_author
    from jsonb_array_elements_text(coalesce(details->'authors','[]')) with ordinality as authors(value,position)
    where btrim(value) <> '';
  next_author := coalesce(next_author,work_row.author);
  select array_agg(value order by position) into next_publishers
    from jsonb_array_elements_text(coalesce(details->'publishers','[]')) with ordinality as publishers(value,position)
    where btrim(value) <> '';
  next_publishers := coalesce(next_publishers,edition_row.publishers);
  previous_row := jsonb_build_object('edition_id',copy_row.edition_id,'work_id',copy_row.work_id,
    'title',work_row.title,'author',work_row.author,'cover_url',copy_row.cover_url,'verification_state',copy_row.edition_verification_state);
  -- Copies can share works. Correct this book without editing other copies.
  insert into public.works(external_key,title,author,contributors,series,subseries)
    values('owner-isbn:'||target_copy_id||':'||edition_row.isbn13,next_title,next_author,
      work_row.contributors,coalesce(nullif(details->>'series',''),work_row.series),work_row.subseries)
    on conflict(external_key) do update set title=excluded.title,author=excluded.author,
      series=excluded.series,updated_at=now() returning id into next_work;
  update public.editions set title=next_title,publishers=next_publishers,
    published_date=coalesce(nullif(details->>'publishedDate',''),published_date),
    language=coalesce(nullif(details->>'language',''),language),
    metadata=metadata || details,updated_at=now() where id=draft_row.edition_id;
  update public.copies set work_id=next_work,edition_id=draft_row.edition_id,
    publisher=coalesce(next_publishers[1],publisher),
    language=coalesce(nullif(details->>'language',''),edition_row.language,language),
    cover_url=coalesce(draft_row.cover_url,edition_row.cover_url,cover_url),cover_source='isbn-resolver',
    edition_verification_state='owner_overridden',edition_confirmed_by=auth.uid(),edition_confirmed_at=now(),updated_at=now()
    where id=target_copy_id;
  update public.edition_candidates set selection_state='alternative' where copy_id=target_copy_id and selection_state<>'owner_rejected';
  update public.edition_candidates set selection_state='owner_selected' where copy_id=target_copy_id and isbn13=edition_row.isbn13;
  select jsonb_build_object('edition_id',edition_id,'work_id',work_id,'title',next_title,'author',next_author,
    'cover_url',cover_url,'verification_state',edition_verification_state) into next_row from public.copies where id=target_copy_id;
  insert into public.audit_events(copy_id,actor_id,action,previous_value,new_value)
    values(target_copy_id,auth.uid(),'publish_edition',previous_row,next_row);
  insert into public.candidate_feedback(copy_id,candidate_id,actor_id,action,replacement_isbn13,algorithm_version,evidence_snapshot)
    select target_copy_id,candidate.id,auth.uid(),case when candidate.provider='manual' then 'manual_isbn' else 'overridden' end,
      candidate.isbn13,candidate.algorithm_version,candidate.evidence from public.edition_candidates candidate
    where candidate.copy_id=target_copy_id and candidate.selection_state='owner_selected' limit 1;
  if not found then
    insert into public.candidate_feedback(copy_id,actor_id,action,replacement_isbn13,algorithm_version,evidence_snapshot)
      values(target_copy_id,auth.uid(),'manual_isbn',edition_row.isbn13,'manual-owner-v2','["manual ISBN entry"]');
  end if;
  delete from public.copy_drafts where copy_id=target_copy_id;
end;
$$;
revoke all on function private.publish_copy_draft(uuid) from public,anon,authenticated;

-- Retain Stage 2 author/language evidence for a later owner selection.
create or replace function public.save_book_isbn_search(target_copy_id uuid, candidates jsonb, provider_failures integer default 0)
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
      copy_id, isbn13, title, authors, language, publishers, published_date, provider, provider_id,
      score, suggested, rank, evidence, selection_state, confidence, algorithm_version,
      score_breakdown, provider_count, provider_identifiers, work_confidence,
      edition_confidence, auto_accept, review_only, manual_search_rank, last_evaluated_at
    ) values (
      target_copy_id, candidate->>'isbn13', candidate->>'title',
      array(select jsonb_array_elements_text(coalesce(candidate->'authors','[]'))), candidate->>'language',
      array(select jsonb_array_elements_text(coalesce(candidate->'publishers','[]'))),
      candidate->>'publishedDate', 'owner-isbn-search-v3', coalesce(candidate->>'providerId',candidate->>'isbn13'),
      (candidate->>'score')::integer, search_rank = 1, search_rank,
      coalesce(candidate->'evidence','[]'), 'alternative', (candidate->>'confidence')::numeric,
      'isbn-ranker-v3', coalesce(candidate->'scoreBreakdown','{}'), (candidate->>'providerCount')::integer,
      coalesce(candidate->'providerIdentifiers','{}'), (candidate->>'workConfidence')::numeric,
      (candidate->>'editionConfidence')::numeric, false, true, search_rank, now()
    ) on conflict(copy_id,isbn13) do update set
      title = excluded.title, authors = excluded.authors, language = excluded.language, publishers = excluded.publishers, published_date = excluded.published_date,
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

