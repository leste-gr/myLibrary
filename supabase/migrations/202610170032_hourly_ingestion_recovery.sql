-- Durable per-book cover state covers ISBN, candidate and metadata resolution.
alter table public.copies
  add column cover_status text not null default 'pending'
    check (cover_status in ('pending', 'processing', 'completed', 'cover_not_found', 'failed')),
  add column cover_attempts integer not null default 0,
  add column cover_started_at timestamptz,
  add column cover_completed_at timestamptz,
  add column cover_next_retry_at timestamptz,
  add column cover_error text;

update public.copies set cover_status = 'completed', cover_completed_at = now()
where cover_url is not null;

alter table public.manual_genai_imports
  add column ingestion_status text not null default 'pending'
    check (ingestion_status in ('pending', 'processing', 'completed', 'failed')),
  add column ingestion_completed_at timestamptz;

create index copies_pending_cover_idx on public.copies(cover_status, cover_next_retry_at, created_at)
  where cover_status in ('pending', 'processing', 'failed');

create function private.track_copy_cover_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.cover_url is not null then
    new.cover_status := 'completed';
    new.cover_completed_at := now();
    new.cover_error := null;
    new.cover_next_retry_at := null;
  elsif tg_op = 'UPDATE' then
    if old.cover_url is not null or new.edition_id is distinct from old.edition_id then
      new.cover_status := 'pending';
      new.cover_completed_at := null;
      new.cover_error := null;
      new.cover_next_retry_at := null;
    end if;
  end if;
  return new;
end;
$$;
create trigger track_copy_cover_status_before_write
before insert or update of cover_url, edition_id on public.copies
for each row execute function private.track_copy_cover_status();

create function public.refresh_ingestion_statuses(target_import_id uuid default null)
returns void language sql security definer set search_path = public as $$
  with states as (
    select i.id,
      case
        when i.matching_status = 'failed' or bool_or(c.cover_status = 'failed') then 'failed'
        when i.matching_status <> 'completed' or bool_or(c.cover_status in ('pending', 'processing')) then
          case when i.matching_status = 'pending' then 'pending' else 'processing' end
        else 'completed'
      end as status
    from public.manual_genai_imports i
    left join public.book_observations o on o.manual_genai_import_id = i.id
    left join public.copies c on c.id = o.copy_id
    where target_import_id is null or i.id = target_import_id
    group by i.id
  )
  update public.manual_genai_imports i
  set ingestion_status = states.status,
      ingestion_completed_at = case when states.status = 'completed' then coalesce(i.ingestion_completed_at, now()) else null end
  from states where states.id = i.id;
$$;

create function public.finish_isbn_matching(target_import_id uuid, failure_message text default null)
returns void language sql security definer set search_path = public as $$
  with counts as (
    select count(*) filter (where status = 'matched' or (status = 'cover_provided' and isbn_text is not null))::integer as matched,
      count(*) filter (where status = 'unresolved')::integer as unresolved,
      count(*) filter (where status = 'ready_for_matching')::integer as retryable
    from public.book_observations where manual_genai_import_id = target_import_id
  )
  update public.manual_genai_imports i
  set matching_status = case when counts.retryable > 0 then 'failed' else 'completed' end,
      matched_count = counts.matched, unresolved_count = counts.unresolved,
      retryable_count = counts.retryable,
      matching_error = case when counts.retryable > 0 then coalesce(failure_message, 'ISBN providers unavailable.') else null end,
      next_retry_at = case when counts.retryable > 0 then date_trunc('hour', now()) + interval '1 hour' else null end,
      matching_completed_at = now()
  from counts where i.id = target_import_id;
$$;

create or replace function public.claim_next_isbn_match()
returns uuid language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  select id into target_id from public.manual_genai_imports
  where matching_status = 'pending'
    or (matching_status = 'failed' and (next_retry_at is null or next_retry_at <= now()))
    or (matching_status = 'processing' and coalesce(matching_started_at, created_at) < now() - interval '10 minutes')
  order by created_at for update skip locked limit 1;
  if target_id is not null then
    update public.manual_genai_imports set matching_status = 'processing',
      matching_attempts = matching_attempts + 1, matching_started_at = now(),
      matching_completed_at = null, matching_error = null, next_retry_at = null,
      ingestion_status = 'processing', ingestion_completed_at = null
    where id = target_id;
  end if;
  return target_id;
end;
$$;

create function public.claim_next_book_cover()
returns uuid language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  select c.id into target_id from public.copies c
  where c.cover_url is null
    and (c.cover_status = 'pending'
      or (c.cover_status = 'failed' and (c.cover_next_retry_at is null or c.cover_next_retry_at <= now()))
      or (c.cover_status = 'processing' and coalesce(c.cover_started_at, c.created_at) < now() - interval '10 minutes'))
    and exists (
      select 1 from public.book_observations o
      join public.manual_genai_imports i on i.id = o.manual_genai_import_id
      where o.copy_id = c.id and o.status in ('matched', 'unresolved', 'cover_provided')
        and i.matching_status = 'completed'
    )
  order by coalesce(c.cover_next_retry_at, c.created_at), c.id
  for update of c skip locked limit 1;
  if target_id is not null then
    update public.copies set cover_status = 'processing', cover_attempts = cover_attempts + 1,
      cover_started_at = now(), cover_completed_at = null, cover_next_retry_at = null, cover_error = null
    where id = target_id;
  end if;
  return target_id;
end;
$$;

create function public.select_resolved_isbn_cover(target_copy_id uuid, target_isbn text)
returns boolean language plpgsql security definer set search_path = public as $$
declare candidate public.edition_candidates%rowtype; asset_id uuid;
begin
  perform 1 from public.copies c join public.editions e on e.id = c.edition_id
  where c.id = target_copy_id and c.cover_status = 'processing' and c.cover_url is null
    and e.isbn13 = target_isbn for update of c;
  if not found then return false; end if;
  select * into candidate from public.edition_candidates
    where copy_id = target_copy_id and isbn13 = target_isbn
    order by (selection_state in ('algorithm_selected', 'owner_selected')) desc, rank limit 1;
  asset_id := private.select_isbn_cover_asset(target_copy_id, target_isbn,
    candidate.provider, candidate.provider_id, candidate.provider_identifiers,
    candidate.evidence, candidate.work_confidence, candidate.edition_confidence);
  update public.copies set cover_url = '/api/cover-assets/' || asset_id,
    cover_source = 'cover-asset', updated_at = now() where id = target_copy_id;
  return true;
end;
$$;

-- Pending ISBN jobs remain useful lookup bookkeeping; book state owns retries.
create or replace function public.claim_next_cover_resolution()
returns table(isbn13 text, attempts integer)
language plpgsql security definer set search_path = public as $$
declare target_isbn text;
begin
  select job.isbn13 into target_isbn from public.cover_resolution_jobs job
  where job.status = 'pending'
    or (job.status = 'failed' and (job.next_retry_at is null or job.next_retry_at <= now()))
    or (job.status = 'processing' and coalesce(job.started_at, job.created_at) < now() - interval '10 minutes')
  order by job.updated_at for update skip locked limit 1;
  if target_isbn is null then return; end if;
  return query update public.cover_resolution_jobs job
  set status = 'processing', attempts = job.attempts + 1, started_at = now(),
    error = null, next_retry_at = null, updated_at = now()
  where job.isbn13 = target_isbn returning job.isbn13, job.attempts;
end;
$$;

revoke all on function private.track_copy_cover_status() from public, anon, authenticated;
revoke all on function public.refresh_ingestion_statuses(uuid) from public, anon, authenticated;
revoke all on function public.finish_isbn_matching(uuid,text) from public, anon, authenticated;
revoke all on function public.claim_next_book_cover() from public, anon, authenticated;
revoke all on function public.select_resolved_isbn_cover(uuid,text) from public, anon, authenticated;
grant execute on function public.refresh_ingestion_statuses(uuid) to service_role;
grant execute on function public.finish_isbn_matching(uuid,text) to service_role;
grant execute on function public.claim_next_book_cover() to service_role;
grant execute on function public.select_resolved_isbn_cover(uuid,text) to service_role;

select public.refresh_ingestion_statuses();

-- Keep job completion correct for assistant-supplied covers, owner edits and
-- deleted books, even when no worker needs to run.
create function private.refresh_related_ingestion_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare related record;
begin
  if tg_table_name = 'manual_genai_imports' then
    perform public.refresh_ingestion_statuses(new.id);
  elsif tg_table_name = 'copies' then
    for related in select distinct manual_genai_import_id as id from public.book_observations
      where copy_id = new.id and manual_genai_import_id is not null
    loop
      perform public.refresh_ingestion_statuses(related.id);
    end loop;
  else
    if tg_op <> 'INSERT' and old.manual_genai_import_id is not null then
      perform public.refresh_ingestion_statuses(old.manual_genai_import_id);
    end if;
    if tg_op <> 'DELETE' and new.manual_genai_import_id is not null then
      perform public.refresh_ingestion_statuses(new.manual_genai_import_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.refresh_related_ingestion_status() from public, anon, authenticated;
create trigger refresh_ingestion_after_matching
after insert or update of matching_status on public.manual_genai_imports
for each row execute function private.refresh_related_ingestion_status();
create trigger refresh_ingestion_after_cover
after update of cover_status, cover_url, edition_id on public.copies
for each row execute function private.refresh_related_ingestion_status();
create trigger refresh_ingestion_after_observation
after insert or update of status, copy_id or delete on public.book_observations
for each row execute function private.refresh_related_ingestion_status();

-- pg_cron invokes the same dispatcher as new imports, at minute zero each hour.
-- The conditional allows the real migration to run in local test Postgres too.
do $$
begin
  if exists(select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('mylibrary-hourly-ingestion-retry', '0 * * * *',
      $cron$select net.http_post(
        url := 'https://khhdjbqaakxqpscilshu.supabase.co/functions/v1/pipeline-dispatch',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{"scheduled":true}'::jsonb,
        timeout_milliseconds := 5000
      );$cron$);
  end if;
end;
$$;
