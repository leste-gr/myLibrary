create table public.chatgpt_import_sessions (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  code_hash text unique not null,
  status text not null default 'pending',
  detected_book_count integer,
  processing_error text,
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint chatgpt_import_status_check check (status in ('pending', 'processing', 'completed', 'failed'))
);

create index chatgpt_import_owner_idx on public.chatgpt_import_sessions(owner_id, created_at desc);
create index chatgpt_import_pending_idx on public.chatgpt_import_sessions(code_hash, expires_at) where status in ('pending', 'failed');

alter table public.chatgpt_import_sessions enable row level security;
grant select, insert, delete on public.chatgpt_import_sessions to authenticated;

create policy "Owners create ChatGPT imports"
on public.chatgpt_import_sessions for insert to authenticated
with check (owner_id = auth.uid() and public.owns_collection(collection_id));

create policy "Owners read ChatGPT imports"
on public.chatgpt_import_sessions for select to authenticated
using (owner_id = auth.uid() and public.owns_collection(collection_id));

create policy "Owners delete ChatGPT imports"
on public.chatgpt_import_sessions for delete to authenticated
using (owner_id = auth.uid() and public.owns_collection(collection_id));

alter table public.book_observations
  drop constraint observation_source_type_check,
  add constraint observation_source_type_check check (source_type in ('shelfie', 'chatgpt_shelfie', 'barcode', 'cover_photo', 'copyright_page', 'manual', 'legacy_import')),
  add column chatgpt_import_session_id uuid references public.chatgpt_import_sessions(id) on delete set null;

create unique index book_observations_chatgpt_order_unique
  on public.book_observations(chatgpt_import_session_id, detection_index)
  where chatgpt_import_session_id is not null and detection_index is not null;
