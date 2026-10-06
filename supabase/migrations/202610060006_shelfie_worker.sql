alter table public.shelfie_uploads
  add column attempt_count integer not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column claimed_by text,
  add column heartbeat_at timestamptz,
  add column content_checksum text,
  add constraint shelfie_attempt_count_check check (attempt_count >= 0);

alter table public.book_observations
  add column shelfie_upload_id uuid references public.shelfie_uploads(id) on delete set null,
  add column detection_index integer;

create index book_observations_shelfie_idx on public.book_observations(shelfie_upload_id);
create unique index book_observations_shelfie_order_unique
  on public.book_observations(shelfie_upload_id, detection_index)
  where shelfie_upload_id is not null and detection_index is not null;

create or replace function public.claim_next_shelfie(worker_name text)
returns setof public.shelfie_uploads
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  select id into target_id
  from public.shelfie_uploads
  where (
      status = 'queued' and next_attempt_at <= now()
    ) or (
      status = 'processing' and heartbeat_at < now() - interval '10 minutes'
    )
  order by created_at
  for update skip locked
  limit 1;

  if target_id is null then return; end if;

  return query
  update public.shelfie_uploads
  set status = 'processing',
      attempt_count = attempt_count + 1,
      claimed_by = worker_name,
      started_at = coalesce(started_at, now()),
      heartbeat_at = now(),
      processing_error = null
  where id = target_id
  returning *;
end;
$$;

create or replace function public.retry_shelfie(target_id uuid, error_message text, delay_seconds integer default 60)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shelfie_uploads
  set status = 'queued',
      processing_error = left(error_message, 2000),
      next_attempt_at = now() + make_interval(secs => greatest(delay_seconds, 5)),
      claimed_by = null,
      heartbeat_at = null
  where id = target_id and status = 'processing';
$$;

revoke all on function public.claim_next_shelfie(text) from public, anon, authenticated;
revoke all on function public.retry_shelfie(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_next_shelfie(text) to service_role;
grant execute on function public.retry_shelfie(uuid, text, integer) to service_role;
