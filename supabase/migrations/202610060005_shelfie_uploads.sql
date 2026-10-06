alter table public.collections drop constraint if exists collections_owner_id_key;
create index if not exists collections_owner_id_idx on public.collections(owner_id, created_at);

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

  if not exists (select 1 from public.collections where owner_id = new.id) then
    insert into public.collections(owner_id, slug, name)
    values (
      new.id,
      'collection-' || left(new.id::text, 8),
      'Η βιβλιοθήκη του/της ' || display_name
    );
  end if;

  return new;
end;
$$;

create table public.shelfie_uploads (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text unique,
  original_filename text not null,
  content_type text not null,
  byte_size bigint not null,
  status text not null default 'queued',
  processing_error text,
  detected_book_count integer,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  asset_deleted_at timestamptz,
  constraint shelfie_upload_status_check check (status in ('queued', 'processing', 'completed', 'failed')),
  constraint shelfie_upload_size_check check (byte_size > 0 and byte_size <= 20971520),
  constraint completed_shelfies_have_no_asset check (
    status <> 'completed' or (storage_path is null and asset_deleted_at is not null)
  )
);

create index shelfie_uploads_collection_idx on public.shelfie_uploads(collection_id, created_at desc);
create index shelfie_uploads_queue_idx on public.shelfie_uploads(status, created_at) where status in ('queued', 'processing');

alter table public.shelfie_uploads enable row level security;
grant select, insert, update, delete on public.shelfie_uploads to authenticated;

create policy "Owners manage their shelfie uploads"
on public.shelfie_uploads for all to authenticated
using (owner_id = auth.uid() and public.owns_collection(collection_id))
with check (owner_id = auth.uid() and public.owns_collection(collection_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shelfies',
  'shelfies',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Owners upload shelfies"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'shelfies'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Owners read shelfies"
on storage.objects for select to authenticated
using (
  bucket_id = 'shelfies'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Owners delete shelfies"
on storage.objects for delete to authenticated
using (
  bucket_id = 'shelfies'
  and (storage.foldername(name))[1] = auth.uid()::text
);
