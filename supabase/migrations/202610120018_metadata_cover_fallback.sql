create table public.metadata_cover_candidates (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.copies(id) on delete cascade,
  provider text not null,
  provider_id text not null,
  source_url text not null,
  title text,
  authors text[] not null default '{}',
  publisher text,
  score integer not null,
  evidence jsonb not null default '[]',
  selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(copy_id, provider, provider_id),
  constraint metadata_cover_provider_check check (provider in ('openlibrary', 'google-books')),
  constraint metadata_cover_score_check check (score >= 0)
);

alter table public.metadata_cover_candidates enable row level security;
grant select on public.metadata_cover_candidates to anon, authenticated;
grant insert, update, delete on public.metadata_cover_candidates to authenticated;

create policy "Public reads selected metadata covers"
on public.metadata_cover_candidates for select to anon, authenticated
using (selected);

create policy "Owners manage metadata cover candidates"
on public.metadata_cover_candidates for all to authenticated
using (exists (
  select 1 from public.copies
  where copies.id = metadata_cover_candidates.copy_id
    and public.owns_collection(copies.collection_id)
))
with check (exists (
  select 1 from public.copies
  where copies.id = metadata_cover_candidates.copy_id
    and public.owns_collection(copies.collection_id)
));

create unique index one_selected_metadata_cover_per_copy
on public.metadata_cover_candidates(copy_id) where selected;

