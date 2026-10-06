create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid unique not null references auth.users(id) on delete cascade,
  slug text unique not null,
  name text not null,
  description text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collection_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

alter table public.collections enable row level security;
grant select on public.collections to anon, authenticated;
grant insert, update, delete on public.collections to authenticated;

create policy "Public can read public collections"
on public.collections for select
using (is_public or owner_id = auth.uid());

create policy "Owners create their collection"
on public.collections for insert to authenticated
with check (owner_id = auth.uid());

create policy "Owners update their collection"
on public.collections for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Owners delete their collection"
on public.collections for delete to authenticated
using (owner_id = auth.uid());

insert into public.collections(owner_id, slug, name, description)
select id, 'lefteris', 'Η βιβλιοθήκη του Λευτέρη', 'Ιστορίες που μένουν, κόσμοι που περιμένουν.'
from auth.users
order by created_at
limit 1
on conflict (owner_id) do nothing;

alter table public.copies add column collection_id uuid references public.collections(id) on delete cascade;
update public.copies
set collection_id = (select id from public.collections order by created_at limit 1)
where collection_id is null;
alter table public.copies alter column collection_id set not null;
alter table public.copies drop constraint if exists copies_legacy_id_key;
alter table public.copies add constraint copies_collection_legacy_id_key unique(collection_id, legacy_id);
create index copies_collection_id_idx on public.copies(collection_id, display_order);

create or replace function public.owns_collection(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.collections
    where id = target_collection_id and owner_id = auth.uid()
  );
$$;

revoke all on function public.owns_collection(uuid) from public;
grant execute on function public.owns_collection(uuid) to authenticated;

drop policy if exists "Public can read published copies" on public.copies;
drop policy if exists "Owners manage copies" on public.copies;
drop policy if exists "Owners manage candidates" on public.edition_candidates;
drop policy if exists "Owners manage drafts" on public.copy_drafts;
drop policy if exists "Owners read audit history" on public.audit_events;

create policy "Public can read published collection copies"
on public.copies for select
using (
  published and exists (
    select 1 from public.collections
    where collections.id = copies.collection_id and collections.is_public
  )
);

create policy "Owners read their copies"
on public.copies for select to authenticated
using (public.owns_collection(collection_id));

create policy "Owners create their copies"
on public.copies for insert to authenticated
with check (public.owns_collection(collection_id));

create policy "Owners update their copies"
on public.copies for update to authenticated
using (public.owns_collection(collection_id))
with check (public.owns_collection(collection_id));

create policy "Owners delete their copies"
on public.copies for delete to authenticated
using (public.owns_collection(collection_id));

create policy "Owners manage their candidates"
on public.edition_candidates for all to authenticated
using (exists (
  select 1 from public.copies
  where copies.id = edition_candidates.copy_id
    and public.owns_collection(copies.collection_id)
))
with check (exists (
  select 1 from public.copies
  where copies.id = edition_candidates.copy_id
    and public.owns_collection(copies.collection_id)
));

create policy "Owners manage their drafts"
on public.copy_drafts for all to authenticated
using (
  created_by = auth.uid() and exists (
    select 1 from public.copies
    where copies.id = copy_drafts.copy_id
      and public.owns_collection(copies.collection_id)
  )
)
with check (
  created_by = auth.uid() and exists (
    select 1 from public.copies
    where copies.id = copy_drafts.copy_id
      and public.owns_collection(copies.collection_id)
  )
);

create policy "Owners read their audit history"
on public.audit_events for select to authenticated
using (exists (
  select 1 from public.copies
  where copies.id = audit_events.copy_id
    and public.owns_collection(copies.collection_id)
));

create or replace view public.public_collections
with (security_invoker = true)
as
select
  collections.id,
  collections.slug,
  collections.name,
  collections.description,
  collections.created_at,
  count(copies.id)::integer as book_count,
  count(distinct works.author)::integer as author_count
from public.collections
left join public.copies on copies.collection_id = collections.id and copies.published
left join public.works on works.id = copies.work_id
where collections.is_public
group by collections.id;

grant select on public.public_collections to anon, authenticated;

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
  e.isbn13,
  c.collection_id,
  collections.slug as collection_slug,
  collections.name as collection_name
from public.copies c
join public.collections on collections.id = c.collection_id
join public.works w on w.id = c.work_id
left join public.editions e on e.id = c.edition_id
where c.published and collections.is_public;

grant select on public.public_catalogue to anon, authenticated;

create or replace function public.create_collection_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  display_name text;
begin
  display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(split_part(new.email, '@', 1), ''),
    'Νέος αναγνώστης'
  );

  insert into public.collections(owner_id, slug, name)
  values (
    new.id,
    'collection-' || left(new.id::text, 8),
    'Η βιβλιοθήκη του/της ' || display_name
  )
  on conflict (owner_id) do nothing;

  return new;
end;
$$;

drop trigger if exists create_collection_after_signup on auth.users;
create trigger create_collection_after_signup
after insert on auth.users
for each row execute function public.create_collection_for_user();
