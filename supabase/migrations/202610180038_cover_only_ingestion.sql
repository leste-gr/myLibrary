-- Ingestion resolves covers only. ISBN fields and owner review/submission remain.
-- Retain matching columns as completed compatibility metadata for older clients.
alter table public.manual_genai_imports alter column matching_status set default 'completed';

-- No candidate insertion may automatically select an ISBN edition.
drop trigger if exists auto_select_isbn_candidate_after_write on public.edition_candidates;
drop trigger if exists mark_visible_isbn_auto_accept_before_write on public.edition_candidates;
drop function public.auto_select_isbn_candidate();
drop function public.apply_best_isbn_candidate(uuid);
drop function private.mark_visible_isbn_auto_accept();

-- An old deployed worker can safely drain nothing during rollout.
create or replace function public.claim_next_isbn_match()
returns uuid language sql security definer set search_path = public as $$ select null::uuid $$;

-- Compatibility helper used by owner cover uploads; it no longer queues matching.
create or replace function public.finish_isbn_matching(target_import_id uuid, failure_message text default null)
returns void language sql security definer set search_path = public as $$
  update public.manual_genai_imports set matching_status = 'completed',
    matching_error = null, retryable_count = 0, next_retry_at = null,
    matching_completed_at = coalesce(matching_completed_at, now())
  where id = target_import_id;
$$;

create or replace function public.refresh_ingestion_statuses(target_import_id uuid default null)
returns void language sql security definer set search_path = public as $$
  with states as (
    select i.id, case
      when bool_or(c.cover_status = 'failed') then 'failed'
      when bool_or(c.cover_status = 'processing') then 'processing'
      when bool_or(c.cover_status = 'pending') then 'pending'
      else 'completed' end as status
    from public.manual_genai_imports i
    left join public.book_observations o on o.manual_genai_import_id = i.id
    left join public.copies c on c.id = o.copy_id
    where target_import_id is null or i.id = target_import_id
    group by i.id
  )
  update public.manual_genai_imports i set ingestion_status = states.status,
    ingestion_completed_at = case when states.status = 'completed' then coalesce(i.ingestion_completed_at, now()) else null end
  from states where states.id = i.id;
$$;

create or replace function public.claim_next_book_cover()
returns uuid language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  select c.id into target_id from public.copies c
  where c.cover_url is null
    and (c.cover_status = 'pending'
      or (c.cover_status = 'failed' and (c.cover_next_retry_at is null or c.cover_next_retry_at <= now()))
      or (c.cover_status = 'processing' and coalesce(c.cover_started_at, c.created_at) < now() - interval '10 minutes'))
    and exists (
      select 1 from public.book_observations o
      where o.copy_id = c.id and o.manual_genai_import_id is not null
        and o.status in ('matched', 'unresolved', 'cover_provided', 'ready_for_matching')
    )
  order by coalesce(c.cover_next_retry_at, c.created_at), c.id
  for update of c skip locked limit 1;
  if target_id is not null then
    update public.copies set cover_status = 'processing', cover_attempts = cover_attempts + 1,
      cover_started_at = now(), cover_completed_at = null, cover_next_retry_at = null, cover_error = null
    where id = target_id;
  end if;
  return target_id;
end;
$$;

create or replace function private.import_manual_genai_books_unfiltered(target_collection_id uuid, target_import_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  book jsonb;
  book_index integer;
  target_work_id uuid;
  target_copy_id uuid;
  first_display_order integer;
  target_legacy_id text;
  target_title text;
  target_author text;
  imported_count integer;
  checksum text;
  existing_import public.manual_genai_imports%rowtype;
  seen_positions integer[] := '{}';
  target_position integer;
begin
  if auth.uid() is null or not public.owns_collection(target_collection_id) then
    raise exception 'You do not own this collection.';
  end if;
  if target_import_id is null then
    raise exception 'target_import_id is required.';
  end if;
  if octet_length(payload::text) > 1048576 then
    raise exception 'The import payload must not exceed 1 MB.';
  end if;
  if payload ->> 'schemaVersion' is distinct from 'mylibrary.shelfie.v1' then
    raise exception 'Unsupported schemaVersion.';
  end if;
  if jsonb_typeof(payload -> 'books') is distinct from 'array' then
    raise exception 'books must be an array.';
  end if;
  imported_count := jsonb_array_length(payload -> 'books');
  if imported_count < 1 or imported_count > 100 then
    raise exception 'books must contain between 1 and 100 items.';
  end if;

  checksum := encode(extensions.digest((payload -> 'books')::text, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_collection_id::text, 0));
  select * into existing_import from public.manual_genai_imports
  where collection_id = target_collection_id and payload_checksum = checksum;
  if found then
    return jsonb_build_object('importId', existing_import.id, 'collectionId', target_collection_id, 'imported', 0, 'duplicate', true);
  end if;

  insert into public.manual_genai_imports(id, collection_id, owner_id, schema_version, payload_checksum, book_count)
  values(target_import_id, target_collection_id, auth.uid(), payload ->> 'schemaVersion', checksum, imported_count);
  select coalesce(max(display_order), 0) + 1 into first_display_order from public.copies where collection_id = target_collection_id;

  for book, book_index in
    select value, (ordinality - 1)::integer from jsonb_array_elements(payload -> 'books') with ordinality
  loop
    if jsonb_typeof(book) is distinct from 'object' or nullif(btrim(book ->> 'title'), '') is null then
      raise exception 'Every book requires a title.';
    end if;
    if char_length(btrim(book ->> 'title')) > 300 then
      raise exception 'Every title must be no longer than 300 characters.';
    end if;
    if jsonb_typeof(book -> 'authors') is distinct from 'array' then
      raise exception 'Every book requires an authors array.';
    end if;
    if jsonb_array_length(book -> 'authors') > 10 or exists (
      select 1 from jsonb_array_elements(book -> 'authors') author_value
      where jsonb_typeof(author_value) is distinct from 'string'
        or nullif(btrim(author_value #>> '{}'), '') is null
        or char_length(btrim(author_value #>> '{}')) > 160
    ) then
      raise exception 'authors must contain at most 10 non-empty names.';
    end if;
    if jsonb_typeof(book -> 'confidence') is distinct from 'number'
      or (book ->> 'confidence')::numeric < 0
      or (book ->> 'confidence')::numeric > 1 then
      raise exception 'Every confidence must be between 0 and 1.';
    end if;
    if jsonb_typeof(book -> 'position') is distinct from 'number'
      or (book ->> 'position')::numeric <> trunc((book ->> 'position')::numeric)
      or (book ->> 'position')::integer not between 1 and 100 then
      raise exception 'Every position must be a positive integer no greater than 100.';
    end if;
    target_position := (book ->> 'position')::integer;
    if target_position = any(seen_positions) then
      raise exception 'Every position must be unique.';
    end if;
    seen_positions := array_append(seen_positions, target_position);
    if book -> 'publicationYear' is not null and book -> 'publicationYear' <> 'null'::jsonb and (
      jsonb_typeof(book -> 'publicationYear') is distinct from 'number'
      or (book ->> 'publicationYear')::numeric <> trunc((book ->> 'publicationYear')::numeric)
      or (book ->> 'publicationYear')::integer not between 1400 and 2100
    ) then
      raise exception 'publicationYear must be null or an integer between 1400 and 2100.';
    end if;
    target_title := btrim(book ->> 'title') || case when nullif(btrim(book ->> 'subtitle'), '') is null then '' else ': ' || btrim(book ->> 'subtitle') end;
    select coalesce(nullif(string_agg(btrim(value), ', '), ''), 'Άγνωστος') into target_author
    from jsonb_array_elements_text(book -> 'authors');

    insert into public.works(external_key, title, author, normalized_title, normalized_author, series, updated_at)
    values(
      'manual-genai:' || target_import_id || ':' || book_index,
      target_title,
      target_author,
      lower(regexp_replace(target_title, '[^[:alnum:]]+', ' ', 'g')),
      lower(regexp_replace(target_author, '[^[:alnum:]]+', ' ', 'g')),
      nullif(book ->> 'series', ''),
      now()
    )
    on conflict(external_key) do update set title = excluded.title, author = excluded.author, normalized_title = excluded.normalized_title, normalized_author = excluded.normalized_author, series = excluded.series, updated_at = now()
    returning id into target_work_id;

    target_legacy_id := 'G-' || upper(left(target_import_id::text, 8)) || '-' || lpad((book_index + 1)::text, 3, '0');
    insert into public.copies(collection_id, legacy_id, work_id, display_order, category, language, volume, publisher, notes, published)
    values(target_collection_id, target_legacy_id, target_work_id, first_display_order + book_index, 'Αταξινόμητα', coalesce(nullif(book ->> 'language', ''), 'Άγνωστη'), nullif(book ->> 'volume', ''), nullif(book ->> 'publisher', ''), nullif(book ->> 'notes', ''), true)
    on conflict(collection_id, legacy_id) do update set work_id = excluded.work_id, language = excluded.language, volume = excluded.volume, publisher = excluded.publisher, notes = excluded.notes, updated_at = now()
    returning id into target_copy_id;

    insert into public.book_observations(collection_id, copy_id, manual_genai_import_id, detection_index, source_type, title_text, author_text, publisher_text, isbn_text, language_hint, format_hint, confidence, status, raw_payload)
    values(target_collection_id, target_copy_id, target_import_id, book_index, 'manual_genai_json', target_title, target_author, nullif(book ->> 'publisher', ''), null, nullif(book ->> 'language', ''), nullif(book ->> 'editionStatement', ''), (book ->> 'confidence')::numeric, 'unresolved', book || jsonb_build_object('source', 'manual-genai-json', 'schemaVersion', payload ->> 'schemaVersion'))
    on conflict(manual_genai_import_id, detection_index) where manual_genai_import_id is not null and detection_index is not null
    do update set copy_id = excluded.copy_id, title_text = excluded.title_text, author_text = excluded.author_text, publisher_text = excluded.publisher_text, isbn_text = excluded.isbn_text, language_hint = excluded.language_hint, format_hint = excluded.format_hint, confidence = excluded.confidence, raw_payload = excluded.raw_payload;

  end loop;

  return jsonb_build_object('importId', target_import_id, 'collectionId', target_collection_id, 'imported', imported_count, 'duplicate', false);
end;
$$;

create or replace function private.import_manual_genai_books(
  target_collection_id uuid,
  target_import_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_count integer;
  filtered_books jsonb;
  result jsonb;
  book jsonb;
  book_index integer;
  target_cover_url text;
  target_copy_id uuid;
  target_observation_id uuid;
  missing_cover_count integer := 0;
begin
  if jsonb_typeof(payload -> 'books') is distinct from 'array' then
    raise exception 'books must be an array.';
  end if;

  source_count := jsonb_array_length(payload -> 'books');
  if source_count < 1 or source_count > 100 then
    raise exception 'books must contain between 1 and 100 items.';
  end if;

  select coalesce(jsonb_agg(item - 'isbn' - 'visibleIsbn' order by ordinality), '[]'::jsonb)
    into filtered_books
  from jsonb_array_elements(payload -> 'books') with ordinality as source(item, ordinality)
  where jsonb_typeof(item) = 'object'
    and nullif(btrim(item ->> 'title'), '') is not null;

  if jsonb_array_length(filtered_books) = 0 then
    raise exception 'At least one book with a title is required.';
  end if;

  for book in select value from jsonb_array_elements(filtered_books) loop
    if book -> 'coverUrl' is not null and book -> 'coverUrl' <> 'null'::jsonb
       and jsonb_typeof(book -> 'coverUrl') is distinct from 'string' then
      raise exception 'coverUrl must be null or a public HTTPS URL.';
    end if;

    target_cover_url := nullif(btrim(book ->> 'coverUrl'), '');
    if target_cover_url is not null and (
      char_length(target_cover_url) > 2048
      or target_cover_url !~ '^https://[^[:space:]]+$'
      or position('@' in split_part(split_part(target_cover_url, '://', 2), '/', 1)) > 0
      or lower(split_part(split_part(target_cover_url, '://', 2), '/', 1)) ~ '^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[::1\])'
    ) then
      raise exception 'coverUrl must be null or a public HTTPS URL.';
    end if;
  end loop;

  result := private.import_manual_genai_books_unfiltered(
    target_collection_id,
    target_import_id,
    jsonb_set(payload, '{books}', filtered_books)
  );

  for book, book_index in
    select value, (ordinality - 1)::integer
    from jsonb_array_elements(filtered_books) with ordinality
  loop
    target_cover_url := nullif(btrim(book ->> 'coverUrl'), '');
    select id, copy_id into target_observation_id, target_copy_id
    from public.book_observations
    where manual_genai_import_id = target_import_id and detection_index = book_index;

    if target_cover_url is null then
      missing_cover_count := missing_cover_count + 1;
      continue;
    end if;

    update public.book_observations
    set status = 'cover_provided',
        raw_payload = raw_payload || jsonb_build_object('coverResolution', 'assistant-supplied')
    where id = target_observation_id;

    update public.copies
    set cover_url = target_cover_url, cover_source = 'assistant-supplied', updated_at = now()
    where id = target_copy_id;

    delete from public.copy_cover_selections where copy_id = target_copy_id;
  end loop;

  update public.book_observations set status = 'unresolved'
    where manual_genai_import_id = target_import_id and status = 'ready_for_matching';
  perform public.finish_isbn_matching(target_import_id);

  return result || jsonb_build_object('backendFallbackBooks', missing_cover_count);
end;
$$;

revoke all on function private.import_manual_genai_books(uuid, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.assistant_update_collection(target_collection_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb; target_import_id uuid := gen_random_uuid(); target_slug text;
  checksum text; existing_import_id uuid; filtered_books jsonb := '[]'::jsonb;
  book jsonb; target_title text; target_author text;
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
    target_title := btrim(coalesce(book->>'title', '')) ||
      case when nullif(btrim(book->>'subtitle'), '') is null then '' else ': ' || btrim(book->>'subtitle') end;
    select coalesce(nullif(string_agg(btrim(value), ', '), ''), 'Άγνωστος') into target_author
    from jsonb_array_elements_text(coalesce(book->'authors', '[]'::jsonb));
    incoming_normalized_title := lower(regexp_replace(target_title, '[^[:alnum:]]+', ' ', 'g'));
    incoming_normalized_author := lower(regexp_replace(target_author, '[^[:alnum:]]+', ' ', 'g'));
    identity_key := 'meta:' || incoming_normalized_title || '|' || incoming_normalized_author || '|' || coalesce(book->>'volume', '');

    if identity_key = any(seen_keys) or exists (
      select 1
      from public.copies c
      join public.works w on w.id = c.work_id
      left join public.editions e on e.id = c.edition_id
      where c.collection_id = target_collection_id and (
        (w.normalized_title = incoming_normalized_title
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

-- Covers are independently schedulable as soon as the import transaction commits.
drop trigger if exists dispatch_ingestion_pipeline_after_insert on public.manual_genai_imports;
create trigger dispatch_ingestion_pipeline_after_insert
after insert on public.manual_genai_imports
for each row execute function private.dispatch_ingestion_pipeline();

-- Release existing imports without altering ISBNs, owner choices or found covers.
update public.book_observations set status = 'unresolved'
where manual_genai_import_id is not null and status = 'ready_for_matching';
update public.manual_genai_imports set matching_status = 'completed',
  matching_error = null, retryable_count = 0, next_retry_at = null,
  matching_completed_at = coalesce(matching_completed_at, now());
select public.refresh_ingestion_statuses();
