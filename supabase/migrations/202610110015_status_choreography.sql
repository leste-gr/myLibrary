-- Status-based handoff between ISBN matching (Stage 2) and cover resolution (Stage 3).
-- Stage 1 producers only create a pending import and ready_for_matching observations.

create table public.cover_resolution_jobs (
  isbn13 text primary key references public.editions(isbn13) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  source text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint cover_resolution_job_status_check check (status in ('pending', 'processing', 'completed', 'missing', 'failed')),
  constraint cover_resolution_job_attempts_check check (attempts >= 0)
);

alter table public.cover_resolution_jobs enable row level security;
revoke all on public.cover_resolution_jobs from public, anon, authenticated;

create index cover_resolution_jobs_work_idx
  on public.cover_resolution_jobs(status, updated_at)
  where status in ('pending', 'processing', 'failed');

create or replace function public.enqueue_isbn_cover_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.isbn13 is not null then
    insert into public.cover_resolution_jobs(isbn13, status, updated_at)
    values(new.isbn13, 'pending', now())
    on conflict(isbn13) do update
      set status = case
        when cover_resolution_jobs.status in ('completed', 'missing') then cover_resolution_jobs.status
        else 'pending'
      end,
      error = case
        when cover_resolution_jobs.status in ('completed', 'missing') then cover_resolution_jobs.error
        else null
      end,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists enqueue_isbn_cover_after_write on public.editions;
create trigger enqueue_isbn_cover_after_write
after insert or update of isbn13 on public.editions
for each row execute function public.enqueue_isbn_cover_resolution();

insert into public.cover_resolution_jobs(isbn13, status)
select isbn13, 'pending' from public.editions where isbn13 is not null
on conflict(isbn13) do nothing;

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
        matching_started_at = now(), matching_completed_at = null
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
     or (job.status = 'failed' and job.attempts < 3)
  order by job.updated_at
  for update skip locked
  limit 1;

  if target_isbn is null then return; end if;
  return query
    update public.cover_resolution_jobs job
    set status = 'processing', attempts = job.attempts + 1, started_at = now(),
        error = null, updated_at = now()
    where job.isbn13 = target_isbn
    returning job.isbn13, job.attempts;
end;
$$;

revoke all on function public.claim_next_isbn_match() from public, anon, authenticated;
revoke all on function public.claim_next_cover_resolution() from public, anon, authenticated;
grant execute on function public.claim_next_isbn_match() to service_role;
grant execute on function public.claim_next_cover_resolution() to service_role;

