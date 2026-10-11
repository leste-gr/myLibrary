-- Replace the draft-oriented MCP write API with atomic backend imports.
drop function if exists public.assistant_create_collection(text, text);

create function public.assistant_update_collection(target_collection_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb; target_import_id uuid := gen_random_uuid(); target_slug text;
  checksum text; existing_import_id uuid;
begin
  if auth.uid() is null or not public.assistant_connection_allowed()
     or not public.owns_collection(target_collection_id) then
    raise exception 'Assistant access denied.';
  end if;
  if payload->>'schemaVersion' = 'mylibrary.shelfie.v1' and jsonb_typeof(payload->'books') = 'array' then
    checksum := encode(extensions.digest((payload->'books')::text, 'sha256'), 'hex');
    select id into existing_import_id from public.manual_genai_imports
    where collection_id = target_collection_id and payload_checksum = checksum;
    if found then
      select slug into target_slug from public.collections where id = target_collection_id;
      return jsonb_build_object('collectionId', target_collection_id, 'slug', target_slug, 'importId', existing_import_id, 'imported', 0, 'duplicate', true);
    end if;
  end if;
  if (select count(*) from public.manual_genai_imports where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Daily import limit reached. Try again tomorrow.';
  end if;
  select slug into target_slug from public.collections where id = target_collection_id;
  result := private.import_manual_genai_books(target_collection_id, target_import_id, payload);
  return result || jsonb_build_object('slug', target_slug);
end;
$$;
revoke all on function public.assistant_update_collection(uuid, jsonb) from public, anon;
grant execute on function public.assistant_update_collection(uuid, jsonb) to authenticated;

create function public.assistant_create_collection(
  collection_name text,
  collection_description text,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid := gen_random_uuid(); target_import_id uuid := gen_random_uuid();
  clean_name text := btrim(collection_name); clean_description text := nullif(btrim(collection_description), '');
  new_slug text; result jsonb; checksum text; existing record;
begin
  if auth.uid() is null or not public.assistant_connection_allowed() then raise exception 'Assistant access denied.'; end if;
  if char_length(clean_name) not between 1 and 120 then raise exception 'Collection name must contain 1–120 characters.'; end if;
  if char_length(coalesce(clean_description, '')) > 1000 then raise exception 'Collection description is too long.'; end if;
  if payload->>'schemaVersion' = 'mylibrary.shelfie.v1' and jsonb_typeof(payload->'books') = 'array' then
    checksum := encode(extensions.digest((payload->'books')::text, 'sha256'), 'hex');
    select c.id, c.slug, mi.id as import_id into existing
    from public.collections c join public.manual_genai_imports mi on mi.collection_id = c.id
    where c.owner_id = auth.uid() and c.name = clean_name and mi.payload_checksum = checksum
    order by mi.created_at desc limit 1;
    if found then
      return jsonb_build_object('collectionId', existing.id, 'slug', existing.slug, 'importId', existing.import_id, 'imported', 0, 'duplicate', true);
    end if;
  end if;
  if (select count(*) from public.collections where owner_id = auth.uid()) >= 50 then raise exception 'Collection limit reached.'; end if;
  if (select count(*) from public.manual_genai_imports where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Daily import limit reached. Try again tomorrow.';
  end if;

  new_slug := 'collection-' || left(replace(new_id::text, '-', ''), 12);
  insert into public.collections(id, owner_id, slug, name, description)
  values(new_id, auth.uid(), new_slug, clean_name, clean_description);
  result := private.import_manual_genai_books(new_id, target_import_id, payload);
  return result || jsonb_build_object('slug', new_slug, 'name', clean_name, 'description', clean_description);
end;
$$;
revoke all on function public.assistant_create_collection(text, text, jsonb) from public, anon;
grant execute on function public.assistant_create_collection(text, text, jsonb) to authenticated;
