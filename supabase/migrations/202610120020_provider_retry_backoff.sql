alter table public.manual_genai_imports
  add column matching_attempts integer not null default 0,
  add column next_retry_at timestamptz,
  add constraint manual_genai_matching_attempts_check check (matching_attempts >= 0);

alter table public.cover_resolution_jobs
  add column next_retry_at timestamptz;

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
     or (matching_status = 'partial' and matching_attempts < 5 and next_retry_at <= now())
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
     or (job.status = 'failed' and job.attempts < 5 and job.next_retry_at <= now())
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
