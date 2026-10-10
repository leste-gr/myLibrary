-- Apply before enabling OAuth. Assistant tokens can only list owned collections
-- and submit private drafts. Browser sessions retain their existing permissions.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.assistant_oauth_clients (
  client_id text primary key,
  resource_url text not null check (resource_url ~ '^https://[^/]+/api/mcp$'),
  enabled boolean not null default true
);
alter table public.assistant_oauth_clients enable row level security;
revoke all on public.assistant_oauth_clients from anon, authenticated;

create table public.assistant_connections (
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null references public.assistant_oauth_clients(client_id) on delete cascade,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(owner_id, client_id)
);
create function public.assistant_client_enabled(target_client_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth.jwt()->>'client_id' is null and exists (
    select 1 from public.assistant_oauth_clients where client_id = target_client_id and enabled
  );
$$;
revoke all on function public.assistant_client_enabled(text) from public, anon;
grant execute on function public.assistant_client_enabled(text) to authenticated;
alter table public.assistant_connections enable row level security;
grant select on public.assistant_connections to authenticated;
create policy "Browser reads own assistant connections" on public.assistant_connections
for select to authenticated using (owner_id = auth.uid() and auth.jwt()->>'client_id' is null);

create function public.set_assistant_connection(target_client_id text, allow_access boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Browser sign-in required.'; end if;
  if allow_access and not exists (select 1 from public.assistant_oauth_clients where client_id = target_client_id and enabled) then
    raise exception 'This assistant client is not enabled.';
  end if;
  insert into public.assistant_connections(owner_id, client_id, active)
    values(auth.uid(), target_client_id, allow_access)
    on conflict(owner_id, client_id) do update set active = excluded.active, updated_at = now();
end; $$;
revoke all on function public.set_assistant_connection(text, boolean) from public, anon;
grant execute on function public.set_assistant_connection(text, boolean) to authenticated;

create function public.assistant_connection_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assistant_oauth_clients c
    join public.assistant_connections g on g.client_id = c.client_id
    where c.client_id = auth.jwt()->>'client_id' and c.enabled
      and g.owner_id = auth.uid() and g.active
      and (auth.jwt()->'aud' = to_jsonb(c.resource_url) or auth.jwt()->'aud' @> jsonb_build_array(c.resource_url))
  );
$$;
revoke all on function public.assistant_connection_allowed() from public, anon;
grant execute on function public.assistant_connection_allowed() to authenticated;

-- Configure this as the Custom Access Token Hook in Supabase Auth.
-- Preserve ordinary browser claims; OAuth tokens are bound to the registered resource.
create function public.assistant_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare claims jsonb := event->'claims'; resource text;
  oauth_client text := coalesce(nullif(event->>'client_id', ''), nullif(event->'claims'->>'client_id', ''));
begin
  if event->>'authentication_method' like 'oauth_provider/%' and oauth_client is null then raise exception 'OAuth client is missing.'; end if;
  if oauth_client is not null then
    select resource_url into resource from public.assistant_oauth_clients
      where client_id = oauth_client and enabled;
    if resource is null then raise exception 'OAuth client is not enabled.'; end if;
    claims := jsonb_set(claims, '{client_id}', to_jsonb(oauth_client));
    claims := jsonb_set(claims, '{aud}', jsonb_build_array('authenticated', resource));
  end if;
  return jsonb_build_object('claims', claims);
end; $$;
revoke all on function public.assistant_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.assistant_access_token_hook(jsonb) to supabase_auth_admin;

-- Restrictive policies compose with existing permissive policies. They also
-- protect the database REST API if an OAuth client calls it directly.
do $$ declare table_name text; begin
  foreach table_name in array array['works','editions','copies','edition_candidates','copy_drafts','audit_events','book_observations','observation_tokens','candidate_evidence','provider_records','candidate_feedback','shelfie_uploads','chatgpt_import_sessions','manual_genai_imports'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('create policy "Browser sessions only" on public.%I as restrictive for all to authenticated using (auth.jwt()->>''client_id'' is null) with check (auth.jwt()->>''client_id'' is null)', table_name);
    end if;
  end loop;
end; $$;
create policy "Assistant reads only owned collection destinations" on public.collections
as restrictive for select to authenticated using (auth.jwt()->>'client_id' is null or (owner_id = auth.uid() and public.assistant_connection_allowed()));
create policy "Browser creates collections" on public.collections as restrictive for insert to authenticated with check (auth.jwt()->>'client_id' is null);
create policy "Browser updates collections" on public.collections as restrictive for update to authenticated using (auth.jwt()->>'client_id' is null) with check (auth.jwt()->>'client_id' is null);
create policy "Browser deletes collections" on public.collections as restrictive for delete to authenticated using (auth.jwt()->>'client_id' is null);
create policy "Browser storage only" on storage.objects as restrictive for all to authenticated
using (auth.jwt()->>'client_id' is null) with check (auth.jwt()->>'client_id' is null);

-- SECURITY DEFINER functions bypass RLS: keep their implementations private and
-- expose browser-only wrappers with the same signatures for existing callers.
alter function public.import_manual_genai_books(uuid, uuid, jsonb) set schema private;
revoke all on function private.import_manual_genai_books(uuid, uuid, jsonb) from public, anon, authenticated;
create function public.import_manual_genai_books(target_collection_id uuid, target_import_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.jwt()->>'client_id' is not null then raise exception 'Review and import in myLibrary.'; end if;
  return private.import_manual_genai_books(target_collection_id, target_import_id, payload);
end; $$;
revoke all on function public.import_manual_genai_books(uuid, uuid, jsonb) from public, anon;
grant execute on function public.import_manual_genai_books(uuid, uuid, jsonb) to authenticated;

alter function public.publish_copy_draft(uuid) set schema private;
revoke all on function private.publish_copy_draft(uuid) from public, anon, authenticated;
create function public.publish_copy_draft(target_copy_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.jwt()->>'client_id' is not null then raise exception 'Browser sign-in required.'; end if;
  perform private.publish_copy_draft(target_copy_id);
end; $$;
revoke all on function public.publish_copy_draft(uuid) from public, anon;
grant execute on function public.publish_copy_draft(uuid) to authenticated;

alter function public.consume_chatgpt_import(text, jsonb) set schema private;
revoke all on function private.consume_chatgpt_import(text, jsonb) from public, anon, authenticated;
create function public.consume_chatgpt_import(target_code_hash text, detected_books jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.jwt()->>'client_id' is not null then raise exception 'Review and import in myLibrary.'; end if;
  return private.consume_chatgpt_import(target_code_hash, detected_books);
end; $$;
revoke all on function public.consume_chatgpt_import(text, jsonb) from public;
grant execute on function public.consume_chatgpt_import(text, jsonb) to anon, authenticated;

create table public.shelfie_import_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  source_client_id text not null,
  payload jsonb not null check (octet_length(payload::text) <= 1048576),
  payload_checksum text not null,
  status text not null default 'pending' check (status in ('pending','imported','discarded')),
  import_result jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(owner_id, collection_id, payload_checksum)
);
create index shelfie_drafts_inbox on public.shelfie_import_drafts(owner_id, status, created_at desc);
alter table public.shelfie_import_drafts enable row level security;
grant select on public.shelfie_import_drafts to authenticated;
create policy "Browser reads own shelfie drafts" on public.shelfie_import_drafts for select to authenticated
using (owner_id = auth.uid() and auth.jwt()->>'client_id' is null and public.owns_collection(collection_id));

create function public.create_shelfie_draft(target_collection_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare draft public.shelfie_import_drafts%rowtype; checksum text; count_books integer;
begin
  if auth.uid() is null or not public.assistant_connection_allowed() or not public.owns_collection(target_collection_id) then raise exception 'Assistant access denied.'; end if;
  if payload is null or octet_length(payload::text) > 1048576 or payload->>'schemaVersion' is distinct from 'mylibrary.shelfie.v1' or jsonb_typeof(payload->'books') is distinct from 'array' then raise exception 'Invalid draft payload.'; end if;
  count_books := jsonb_array_length(payload->'books');
  if count_books not between 1 and 100 then raise exception 'Draft requires 1–100 books.'; end if;
  -- Serialize quota and duplicate checks per owner; retries return the same draft.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 1));
  checksum := encode(extensions.digest((payload->'books')::text, 'sha256'), 'hex');
  select * into draft from public.shelfie_import_drafts where owner_id = auth.uid() and collection_id = target_collection_id and payload_checksum = checksum;
  if found then return jsonb_build_object('draftId', draft.id, 'status', draft.status, 'bookCount', jsonb_array_length(draft.payload->'books')); end if;
  if (select count(*) from public.shelfie_import_drafts where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then raise exception 'Daily draft limit reached. Try again tomorrow.'; end if;
  insert into public.shelfie_import_drafts(owner_id, collection_id, source_client_id, payload, payload_checksum)
  values(auth.uid(), target_collection_id, auth.jwt()->>'client_id', payload, checksum) returning * into draft;
  return jsonb_build_object('draftId', draft.id, 'status', draft.status, 'bookCount', count_books);
end; $$;
revoke all on function public.create_shelfie_draft(uuid, jsonb) from public, anon;
grant execute on function public.create_shelfie_draft(uuid, jsonb) to authenticated;

create function public.confirm_shelfie_draft(target_draft_id uuid, reviewed_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare draft public.shelfie_import_drafts%rowtype; result jsonb;
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Browser sign-in required.'; end if;
  select * into draft from public.shelfie_import_drafts where id = target_draft_id and owner_id = auth.uid() for update;
  if not found or not public.owns_collection(draft.collection_id) then raise exception 'Draft not found.'; end if;
  if draft.status = 'imported' then return draft.import_result; end if;
  if draft.status <> 'pending' then raise exception 'Draft was discarded.'; end if;
  result := public.import_manual_genai_books(draft.collection_id, draft.id, reviewed_payload);
  update public.shelfie_import_drafts set status = 'imported', import_result = result, reviewed_at = now() where id = draft.id;
  return result;
end; $$;
revoke all on function public.confirm_shelfie_draft(uuid, jsonb) from public, anon;
grant execute on function public.confirm_shelfie_draft(uuid, jsonb) to authenticated;

create function public.discard_shelfie_draft(target_draft_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Browser sign-in required.'; end if;
  update public.shelfie_import_drafts set status = 'discarded', reviewed_at = now()
  where id = target_draft_id and owner_id = auth.uid() and status = 'pending' and public.owns_collection(collection_id);
  if not found then raise exception 'Pending draft not found.'; end if;
end; $$;
revoke all on function public.discard_shelfie_draft(uuid) from public, anon;
grant execute on function public.discard_shelfie_draft(uuid) to authenticated;
commit;
