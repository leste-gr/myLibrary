-- A strong work match may provide a useful representative cover even when the
-- evidence is insufficient to assign a physical edition's ISBN.
create or replace function public.select_candidate_representative_cover(
  target_candidate_id uuid,
  target_cover_confidence numeric,
  detected_source text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.edition_candidates%rowtype;
  target_collection_id uuid;
  target_asset_id uuid;
begin
  if detected_source not in ('legacy-library', 'openlibrary', 'google-books') then
    raise exception 'Unsupported cover source.';
  end if;
  if target_cover_confidence < 0 or target_cover_confidence > 1 then
    raise exception 'Invalid cover confidence.';
  end if;

  select ec.* into candidate
  from public.edition_candidates ec
  join public.copies c on c.id = ec.copy_id
  where ec.id = target_candidate_id
    and ec.rank = 1
    and ec.selection_state <> 'owner_rejected'
    and ec.work_confidence >= 0.85
    and c.edition_id is null
    and c.edition_verification_state = 'unresolved';
  if not found then raise exception 'Eligible candidate not found.'; end if;
  select collection_id into target_collection_id from public.copies where id = candidate.copy_id;
  if coalesce(auth.role(), '') <> 'service_role' and not public.owns_collection(target_collection_id) then
    raise exception 'Collection ownership required.';
  end if;

  insert into public.cover_assets(
    canonical_key, source_type, source_url, provider, provider_record_id, isbn13,
    provider_identifiers, evidence, work_confidence, edition_confidence,
    cover_confidence, verification_status, storage_policy
  ) values (
    'isbn:' || candidate.isbn13, 'isbn', '/api/covers/' || candidate.isbn13,
    detected_source, candidate.provider_id, candidate.isbn13,
    candidate.provider_identifiers,
    candidate.evidence || jsonb_build_array('verified cover image from ' || detected_source),
    candidate.work_confidence, candidate.edition_confidence,
    target_cover_confidence, 'algorithm_verified', 'reference'
  )
  on conflict(canonical_key) do update set
    provider = excluded.provider,
    provider_record_id = coalesce(cover_assets.provider_record_id, excluded.provider_record_id),
    provider_identifiers = cover_assets.provider_identifiers || excluded.provider_identifiers,
    evidence = cover_assets.evidence || excluded.evidence,
    work_confidence = greatest(cover_assets.work_confidence, excluded.work_confidence),
    edition_confidence = greatest(cover_assets.edition_confidence, excluded.edition_confidence),
    cover_confidence = greatest(cover_assets.cover_confidence, excluded.cover_confidence),
    verification_status = 'algorithm_verified',
    updated_at = now()
  returning id into target_asset_id;

  update public.edition_candidates
  set cover_confidence = greatest(cover_confidence, target_cover_confidence),
      last_evaluated_at = now()
  where id = candidate.id;

  insert into public.copy_cover_selections(copy_id, cover_asset_id, usage_scope, decision_source, selected_at)
  values(candidate.copy_id, target_asset_id, 'representative', 'algorithm', now())
  on conflict(copy_id) do update set
    cover_asset_id = excluded.cover_asset_id,
    usage_scope = 'representative',
    decision_source = 'algorithm',
    selected_by = null,
    selected_at = now();

  update public.copies
  set cover_url = '/api/cover-assets/' || target_asset_id,
      cover_source = 'cover-asset',
      updated_at = now()
  where id = candidate.copy_id
    and edition_id is null
    and cover_url is null
    and edition_verification_state = 'unresolved';

  return target_asset_id;
end;
$$;

revoke all on function public.select_candidate_representative_cover(uuid,numeric,text) from public, anon;
grant execute on function public.select_candidate_representative_cover(uuid,numeric,text) to authenticated, service_role;
