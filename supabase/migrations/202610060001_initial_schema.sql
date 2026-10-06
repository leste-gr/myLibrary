create extension if not exists pgcrypto;

create table public.works (
  id uuid primary key default gen_random_uuid(),
  external_key text unique not null,
  title text not null,
  author text not null,
  contributors text,
  series text,
  subseries text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  isbn13 text unique,
  title text,
  publishers text[] not null default '{}',
  published_date text,
  language text,
  cover_url text,
  provider text,
  provider_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint isbn13_format check (isbn13 is null or isbn13 ~ '^97[89][0-9]{10}$')
);

create table public.copies (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique not null,
  work_id uuid not null references public.works(id) on delete restrict,
  edition_id uuid references public.editions(id) on delete set null,
  display_order integer not null,
  category text not null,
  language text not null,
  volume text,
  publisher text,
  notes text,
  cover_url text,
  cover_source text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.edition_candidates (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.copies(id) on delete cascade,
  isbn13 text not null,
  title text,
  publishers text[] not null default '{}',
  published_date text,
  cover_url text,
  provider text not null,
  provider_id text not null,
  score integer not null default 0,
  suggested boolean not null default false,
  rank integer not null,
  evidence jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique(copy_id, isbn13),
  constraint candidate_isbn13_format check (isbn13 ~ '^97[89][0-9]{10}$')
);

create table public.copy_drafts (
  copy_id uuid primary key references public.copies(id) on delete cascade,
  edition_id uuid not null references public.editions(id) on delete restrict,
  cover_url text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  copy_id uuid not null references public.copies(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index copies_work_id_idx on public.copies(work_id);
create index candidates_copy_id_idx on public.edition_candidates(copy_id);
create index audit_events_copy_id_idx on public.audit_events(copy_id, created_at desc);

alter table public.works enable row level security;
alter table public.editions enable row level security;
alter table public.copies enable row level security;
alter table public.edition_candidates enable row level security;
alter table public.copy_drafts enable row level security;
alter table public.audit_events enable row level security;

grant select on public.works, public.editions, public.copies to anon;
grant select, insert, update, delete on public.works, public.editions, public.copies to authenticated;
grant select, insert, update, delete on public.edition_candidates, public.copy_drafts to authenticated;
grant select on public.audit_events to authenticated;

create policy "Public can read works" on public.works for select using (true);
create policy "Public can read editions" on public.editions for select using (true);
create policy "Public can read published copies" on public.copies for select using (published);
create policy "Owners manage works" on public.works for all to authenticated using (true) with check (true);
create policy "Owners manage editions" on public.editions for all to authenticated using (true) with check (true);
create policy "Owners manage copies" on public.copies for all to authenticated using (true) with check (true);
create policy "Owners manage candidates" on public.edition_candidates for all to authenticated using (true) with check (true);
create policy "Owners manage drafts" on public.copy_drafts for all to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "Owners read audit history" on public.audit_events for select to authenticated using (true);

create or replace view public.public_catalogue
with (security_invoker = true)
as
select
  c.legacy_id,
  c.display_order,
  w.title,
  w.author,
  w.contributors,
  w.series,
  w.subseries,
  c.volume,
  c.language,
  c.category,
  coalesce(e.publishers[1], c.publisher) as publisher,
  c.notes,
  coalesce(c.cover_url, e.cover_url) as cover_url,
  c.cover_source,
  e.isbn13
from public.copies c
join public.works w on w.id = c.work_id
left join public.editions e on e.id = c.edition_id
where c.published;

grant select on public.public_catalogue to anon, authenticated;

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
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into draft_row
  from public.copy_drafts
  where copy_id = target_copy_id and created_by = auth.uid()
  for update;

  if not found then
    raise exception 'Draft not found';
  end if;

  select jsonb_build_object('edition_id', edition_id, 'cover_url', cover_url)
  into previous_row
  from public.copies where id = target_copy_id;

  update public.copies
  set edition_id = draft_row.edition_id,
      cover_url = coalesce(draft_row.cover_url, (select cover_url from public.editions where id = draft_row.edition_id), cover_url),
      updated_at = now()
  where id = target_copy_id;

  select jsonb_build_object('edition_id', edition_id, 'cover_url', cover_url)
  into next_row
  from public.copies where id = target_copy_id;

  insert into public.audit_events(copy_id, actor_id, action, previous_value, new_value)
  values(target_copy_id, auth.uid(), 'publish_edition', previous_row, next_row);

  delete from public.copy_drafts where copy_id = target_copy_id;
end;
$$;

revoke all on function public.publish_copy_draft(uuid) from public;
grant execute on function public.publish_copy_draft(uuid) to authenticated;
