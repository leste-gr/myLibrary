-- Stage 2 selects an edition and enqueues its ISBN; only Stage 3 assigns covers.
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
  where copy_id = target_copy_id and selection_state <> 'owner_rejected' and provider <> 'manual' and auto_accept
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


-- Completed ISBN jobs can be reused by copies imported after the original lookup.
create or replace function public.attach_resolved_isbn_covers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  asset_id uuid;
  attached integer := 0;
begin
  for candidate in
    select ec.* from public.edition_candidates ec
    join public.copies c on c.id = ec.copy_id
    join public.editions e on e.id = c.edition_id and e.isbn13 = ec.isbn13
    join public.cover_resolution_jobs job on job.isbn13 = e.isbn13
    where ec.selection_state = 'algorithm_selected'
      and c.edition_verification_state = 'algorithm_selected'
      and c.cover_url is null and job.status = 'completed'
    for update of c
  loop
    asset_id := private.select_isbn_cover_asset(candidate.copy_id, candidate.isbn13,
      candidate.provider, candidate.provider_id, candidate.provider_identifiers,
      candidate.evidence, candidate.work_confidence, candidate.edition_confidence);
    update public.copies set cover_url = '/api/cover-assets/' || asset_id,
      cover_source = 'cover-asset', updated_at = now() where id = candidate.copy_id;
    update public.edition_candidates set cover_url = '/api/covers/' || candidate.isbn13
      where id = candidate.id;
    attached := attached + 1;
  end loop;
  return attached;
end;
$$;
revoke all on function public.attach_resolved_isbn_covers() from public, anon, authenticated;
grant execute on function public.attach_resolved_isbn_covers() to service_role;
