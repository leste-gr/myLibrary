-- Keep ingestion event-driven. Retire scheduled/owner retries and terminalize
-- queue state left by the former retry paths without touching catalogue data.

update public.book_observations observation
set status = 'unresolved'
from public.manual_genai_imports import
where observation.manual_genai_import_id = import.id
  and observation.status = 'ready_for_matching'
  and import.matching_status in ('pending', 'processing', 'partial', 'failed');

update public.manual_genai_imports import
set matching_status = 'completed',
    matched_count = summary.matched_count,
    unresolved_count = summary.unresolved_count,
    retryable_count = 0,
    matching_error = null,
    matching_completed_at = now(),
    next_retry_at = null
from (
  select manual_genai_import_id,
         count(*) filter (where status = 'matched')::integer as matched_count,
         count(*) filter (where status = 'unresolved')::integer as unresolved_count
  from public.book_observations
  where manual_genai_import_id is not null
  group by manual_genai_import_id
) summary
where import.id = summary.manual_genai_import_id
  and import.matching_status in ('pending', 'processing', 'partial', 'failed');

-- These rows are queue bookkeeping only. Cover selections and catalogue records
-- remain intact and continue to resolve through their existing cover assets.
delete from public.cover_resolution_jobs
where status in ('pending', 'processing', 'failed');

drop table if exists public.ingestion_pipeline_runs;

drop index if exists public.manual_genai_imports_matching_status_idx;
create index manual_genai_imports_matching_status_idx
  on public.manual_genai_imports(collection_id, created_at desc)
  where matching_status in ('pending', 'processing', 'failed');

alter table public.manual_genai_imports
  drop constraint if exists manual_genai_matching_status_check;
alter table public.manual_genai_imports
  add constraint manual_genai_matching_status_check
  check (matching_status in ('pending', 'processing', 'completed', 'failed'));

create or replace function public.claim_next_isbn_match()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare target_id uuid;
begin
  select id into target_id
  from public.manual_genai_imports
  where matching_status = 'pending'
     or (matching_status = 'processing' and matching_started_at < now() - interval '10 minutes')
  order by created_at
  for update skip locked
  limit 1;

  if target_id is not null then
    update public.manual_genai_imports
    set matching_status = 'processing', matching_error = null,
        matching_attempts = matching_attempts + 1,
        matching_started_at = now(), matching_completed_at = null,
        next_retry_at = null
    where id = target_id;
  end if;
  return target_id;
end;
$$;

create or replace function public.claim_next_cover_resolution()
returns table(isbn13 text, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
declare target_isbn text;
begin
  select job.isbn13 into target_isbn
  from public.cover_resolution_jobs job
  where job.status = 'pending'
     or (job.status = 'processing' and job.started_at < now() - interval '10 minutes')
  order by job.updated_at
  for update skip locked
  limit 1;

  if target_isbn is null then return; end if;
  return query
    update public.cover_resolution_jobs job
    set status = 'processing', attempts = job.attempts + 1, started_at = now(),
        error = null, next_retry_at = null, updated_at = now()
    where job.isbn13 = target_isbn
    returning job.isbn13, job.attempts;
end;
$$;

revoke all on function public.claim_next_isbn_match() from public, anon, authenticated;
revoke all on function public.claim_next_cover_resolution() from public, anon, authenticated;
grant execute on function public.claim_next_isbn_match() to service_role;
grant execute on function public.claim_next_cover_resolution() to service_role;
