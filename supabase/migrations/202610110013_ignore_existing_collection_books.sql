-- Make connected updates additive at the book level: existing books are ignored.
create or replace function public.assistant_update_collection(target_collection_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb; target_import_id uuid := gen_random_uuid(); target_slug text;
  checksum text; existing_import_id uuid; filtered_books jsonb := '[]'::jsonb;
  book jsonb; target_isbn text; target_title text; target_author text;
  incoming_normalized_title text; incoming_normalized_author text; identity_key text;
  seen_keys text[] := '{}'; ignored_count integer := 0;
begin
  if auth.uid() is null or not public.assistant_connection_allowed()
     or not public.owns_collection(target_collection_id) then
    raise exception 'Assistant access denied.';
  end if;
  if octet_length(payload::text) > 1048576 then raise exception 'The import payload must not exceed 1 MB.'; end if;
  if payload->>'schemaVersion' is distinct from 'mylibrary.shelfie.v1'
     or jsonb_typeof(payload->'books') is distinct from 'array'
     or jsonb_array_length(payload->'books') not between 1 and 100 then
    raise exception 'Invalid book payload.';
  end if;

  checksum := encode(extensions.digest((payload->'books')::text, 'sha256'), 'hex');
  select slug into target_slug from public.collections where id = target_collection_id;
  select id into existing_import_id from public.manual_genai_imports
  where collection_id = target_collection_id and payload_checksum = checksum;
  if found then
    return jsonb_build_object('collectionId', target_collection_id, 'slug', target_slug,
      'importId', existing_import_id, 'imported', 0, 'ignoredExisting', jsonb_array_length(payload->'books'), 'duplicate', true);
  end if;

  for book in select value from jsonb_array_elements(payload->'books') loop
    target_isbn := nullif(book->>'visibleIsbn', '');
    target_title := btrim(coalesce(book->>'title', '')) ||
      case when nullif(btrim(book->>'subtitle'), '') is null then '' else ': ' || btrim(book->>'subtitle') end;
    select coalesce(nullif(string_agg(btrim(value), ', '), ''), 'Άγνωστος') into target_author
    from jsonb_array_elements_text(coalesce(book->'authors', '[]'::jsonb));
    incoming_normalized_title := lower(regexp_replace(target_title, '[^[:alnum:]]+', ' ', 'g'));
    incoming_normalized_author := lower(regexp_replace(target_author, '[^[:alnum:]]+', ' ', 'g'));
    identity_key := case when target_isbn is not null then 'isbn:' || target_isbn
      else 'meta:' || incoming_normalized_title || '|' || incoming_normalized_author || '|' || coalesce(book->>'volume', '') end;

    if identity_key = any(seen_keys) or exists (
      select 1
      from public.copies c
      join public.works w on w.id = c.work_id
      left join public.editions e on e.id = c.edition_id
      where c.collection_id = target_collection_id and (
        (target_isbn is not null and (e.isbn13 = target_isbn or exists (
          select 1 from public.book_observations observation
          where observation.copy_id = c.id and observation.isbn_text = target_isbn
        )))
        or (target_isbn is null and w.normalized_title = incoming_normalized_title
          and w.normalized_author = incoming_normalized_author
          and coalesce(c.volume, '') = coalesce(book->>'volume', ''))
      )
    ) then
      ignored_count := ignored_count + 1;
    else
      seen_keys := array_append(seen_keys, identity_key);
      filtered_books := filtered_books || jsonb_build_array(book);
    end if;
  end loop;

  if jsonb_array_length(filtered_books) = 0 then
    return jsonb_build_object('collectionId', target_collection_id, 'slug', target_slug,
      'importId', null, 'imported', 0, 'ignoredExisting', ignored_count, 'duplicate', true);
  end if;
  if (select count(*) from public.manual_genai_imports where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Daily import limit reached. Try again tomorrow.';
  end if;

  result := private.import_manual_genai_books(target_collection_id, target_import_id,
    jsonb_set(payload, '{books}', filtered_books));
  return result || jsonb_build_object('slug', target_slug, 'ignoredExisting', ignored_count);
end;
$$;
revoke all on function public.assistant_update_collection(uuid, jsonb) from public, anon;
grant execute on function public.assistant_update_collection(uuid, jsonb) to authenticated;
