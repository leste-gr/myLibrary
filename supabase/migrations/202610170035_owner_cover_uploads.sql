insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('book-covers', 'book-covers', false, 4194304, array['image/webp'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.copies add column owner_cover_path text;

create policy "Owners upload book covers" on storage.objects for insert to authenticated
with check (bucket_id = 'book-covers'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.copies c where c.id::text = (storage.foldername(name))[2]
    and public.owns_collection(c.collection_id)));

create policy "Visible books expose their uploaded cover" on storage.objects for select to anon, authenticated
using (bucket_id = 'book-covers' and exists (
  select 1 from public.copies c join public.collections collection on collection.id = c.collection_id
  where c.owner_cover_path = storage.objects.name
    and c.published and collection.is_public
));

create policy "Owners manage their uploaded cover objects" on storage.objects for select to authenticated
using (bucket_id = 'book-covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Owners remove their uploaded cover objects" on storage.objects for delete to authenticated
using (bucket_id = 'book-covers' and (storage.foldername(name))[1] = auth.uid()::text);
grant select on storage.objects to anon;

create function private.preserve_owner_uploaded_cover()
returns trigger language plpgsql security definer set search_path = public as $$
declare collection_owner uuid;
begin
  if new.owner_cover_path is not null then
    select owner_id into collection_owner from public.collections where id = new.collection_id;
    if new.owner_cover_path !~ ('^' || collection_owner::text || '/' || new.id::text || '/[0-9a-f-]{36}\.webp$') then
      raise exception 'Invalid owner cover path.';
    end if;
    new.cover_url := '/api/book-covers/' || new.id || '/' || split_part(new.owner_cover_path, '/', 3);
    new.cover_source := 'owner-upload';
    new.cover_status := 'completed';
    new.cover_completed_at := now();
    new.cover_error := null;
    new.cover_next_retry_at := null;
  end if;
  return new;
end;
$$;
create trigger preserve_owner_cover_before_write
before insert or update of owner_cover_path, cover_url, edition_id on public.copies
for each row execute function private.preserve_owner_uploaded_cover();

create function private.sync_owner_cover_selection()
returns trigger language plpgsql security definer set search_path = public as $$
declare asset_id uuid; collection_owner uuid;
begin
  if new.owner_cover_path is null then return null; end if;
  select owner_id into collection_owner from public.collections where id = new.collection_id;
  insert into public.cover_assets(canonical_key, source_type, source_url, provider,
    verification_status, storage_policy, evidence, cover_confidence)
  values ('owner-upload:' || new.owner_cover_path, 'owner_upload', new.cover_url,
    'owner-upload', 'owner_verified', 'retained', '["Cover image uploaded by collection owner"]', 1)
  on conflict(canonical_key) do update set source_url = excluded.source_url
  returning id into asset_id;
  insert into public.copy_cover_selections(copy_id, cover_asset_id, usage_scope, decision_source, selected_by)
  values(new.id, asset_id, case when new.edition_id is null then 'representative' else 'exact_edition' end, 'owner', collection_owner)
  on conflict(copy_id) do update set cover_asset_id = excluded.cover_asset_id,
    usage_scope = excluded.usage_scope, decision_source = 'owner', selected_by = excluded.selected_by, selected_at = now();
  return null;
end;
$$;
create trigger sync_owner_cover_selection_after_write
after insert or update of owner_cover_path, cover_url, edition_id on public.copies
for each row execute function private.sync_owner_cover_selection();

create function public.set_owned_book_cover(target_copy_id uuid, storage_path text)
returns void language plpgsql security definer set search_path = public as $$
declare target_collection uuid; filename text; related_import uuid;
begin
  select collection_id into target_collection from public.copies where id = target_copy_id for update;
  if auth.uid() is null or target_collection is null or not public.owns_collection(target_collection) then
    raise exception 'Collection ownership required.';
  end if;
  filename := split_part(storage_path, '/', 3);
  if storage_path <> auth.uid()::text || '/' || target_copy_id::text || '/' || filename
    or filename !~ '^[0-9a-f-]{36}\.webp$' then raise exception 'Invalid owner cover path.'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'book-covers' and name = storage_path) then
    raise exception 'Uploaded cover not found.';
  end if;
  update public.copies set owner_cover_path = storage_path,
    cover_url = '/api/book-covers/' || target_copy_id || '/' || filename,
    cover_source = 'owner-upload', updated_at = now() where id = target_copy_id;
  update public.book_observations set status = 'cover_provided',
    raw_payload = raw_payload || jsonb_build_object('coverResolution', 'owner-upload')
  where copy_id = target_copy_id;
  for related_import in select distinct manual_genai_import_id from public.book_observations
    where copy_id = target_copy_id and manual_genai_import_id is not null
  loop
    perform public.finish_isbn_matching(related_import);
  end loop;
end;
$$;
revoke all on function private.preserve_owner_uploaded_cover() from public, anon, authenticated;
revoke all on function private.sync_owner_cover_selection() from public, anon, authenticated;
revoke all on function public.set_owned_book_cover(uuid,text) from public, anon;
grant execute on function public.set_owned_book_cover(uuid,text) to authenticated;
