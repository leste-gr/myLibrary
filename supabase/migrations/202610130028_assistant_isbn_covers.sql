-- Stage 1 may now provide a verified edition ISBN and a direct public cover URL.
-- Books with a supplied cover are finalized during ingestion; only books without
-- one remain eligible for the existing Stage 2 / Stage 3 fallback pipeline.

alter table public.book_observations drop constraint if exists observation_status_check;
alter table public.book_observations
  add constraint observation_status_check check (status in ('pending', 'ready_for_matching', 'matched', 'unresolved', 'rejected', 'cover_provided'));

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
  target_isbn text;
  target_visible_isbn text;
  target_cover_url text;
  target_copy_id uuid;
  target_observation_id uuid;
  target_edition_id uuid;
  target_title text;
  target_author text;
  missing_cover_count integer := 0;
  supplied_isbn_count integer := 0;
  isbn_checksum integer;
begin
  if jsonb_typeof(payload -> 'books') is distinct from 'array' then
    raise exception 'books must be an array.';
  end if;

  source_count := jsonb_array_length(payload -> 'books');
  if source_count < 1 or source_count > 100 then
    raise exception 'books must contain between 1 and 100 items.';
  end if;

  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
    into filtered_books
  from jsonb_array_elements(payload -> 'books') with ordinality as source(item, ordinality)
  where jsonb_typeof(item) = 'object'
    and nullif(btrim(item ->> 'title'), '') is not null;

  if jsonb_array_length(filtered_books) = 0 then
    raise exception 'At least one book with a title is required.';
  end if;

  for book in select value from jsonb_array_elements(filtered_books) loop
    if book -> 'isbn' is not null and book -> 'isbn' <> 'null'::jsonb
       and jsonb_typeof(book -> 'isbn') is distinct from 'string' then
      raise exception 'isbn must be null or a canonical ISBN-13.';
    end if;
    if book -> 'coverUrl' is not null and book -> 'coverUrl' <> 'null'::jsonb
       and jsonb_typeof(book -> 'coverUrl') is distinct from 'string' then
      raise exception 'coverUrl must be null or a public HTTPS URL.';
    end if;

    target_isbn := nullif(book ->> 'isbn', '');
    target_visible_isbn := nullif(book ->> 'visibleIsbn', '');
    if target_isbn is not null and target_visible_isbn is not null and target_isbn <> target_visible_isbn then
      raise exception 'isbn and visibleIsbn must identify the same edition.';
    end if;
    target_isbn := coalesce(target_isbn, target_visible_isbn);
    if target_isbn is not null then
      if target_isbn !~ '^97[89][0-9]{10}$' then
        raise exception 'isbn must be null or a canonical ISBN-13.';
      end if;
      select sum(substring(target_isbn from digit_index for 1)::integer * case when digit_index % 2 = 0 then 3 else 1 end)
        into isbn_checksum from generate_series(1, 12) digit_index;
      if (isbn_checksum + right(target_isbn, 1)::integer) % 10 <> 0 then
        raise exception 'isbn has an invalid check digit.';
      end if;
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
    target_isbn := coalesce(nullif(book ->> 'isbn', ''), nullif(book ->> 'visibleIsbn', ''));
    target_visible_isbn := nullif(book ->> 'visibleIsbn', '');
    target_cover_url := nullif(btrim(book ->> 'coverUrl'), '');
    target_title := btrim(book ->> 'title') || case when nullif(btrim(book ->> 'subtitle'), '') is null then '' else ': ' || btrim(book ->> 'subtitle') end;
    select coalesce(nullif(string_agg(btrim(value), ', '), ''), 'Άγνωστος') into target_author
    from jsonb_array_elements_text(book -> 'authors');

    select id, copy_id into target_observation_id, target_copy_id
    from public.book_observations
    where manual_genai_import_id = target_import_id and detection_index = book_index;

    if target_isbn is not null then
      supplied_isbn_count := supplied_isbn_count + 1;
      update public.book_observations
      set isbn_text = target_isbn,
          raw_payload = raw_payload || jsonb_build_object('isbnResolution', case when target_visible_isbn is not null then 'photo' else 'assistant-web' end)
      where id = target_observation_id;

      insert into public.edition_candidates(
        copy_id, isbn13, title, publishers, published_date, cover_url, provider, provider_id,
        score, suggested, rank, evidence, selection_state, confidence, algorithm_version,
        score_breakdown, provider_count, last_evaluated_at, work_confidence,
        edition_confidence, cover_confidence, auto_accept, provider_identifiers
      ) values(
        target_copy_id, target_isbn, target_title,
        case when nullif(book ->> 'publisher', '') is null then '{}'::text[] else array[book ->> 'publisher'] end,
        nullif(book ->> 'publicationYear', ''), coalesce(target_cover_url, '/api/covers/' || target_isbn),
        case when target_visible_isbn is not null then 'assistant-visible-isbn' else 'assistant-web' end,
        'assistant:' || target_import_id || ':' || book_index,
        1400, true, 1,
        jsonb_build_array(case when target_visible_isbn is not null then 'checksum-valid ISBN read from shelf photo' else 'ISBN retrieved from a matching edition page by the connected assistant' end),
        case when target_cover_url is not null then 'algorithm_selected' else 'alternative' end,
        (book ->> 'confidence')::numeric, 'assistant-research-v1', '{"assistant_verified_isbn":1400}'::jsonb,
        1, now(), (book ->> 'confidence')::numeric, (book ->> 'confidence')::numeric,
        case when target_cover_url is null then null else (book ->> 'confidence')::numeric end,
        target_cover_url is null, '{}'::jsonb
      )
      on conflict(copy_id, isbn13) do update set
        title = excluded.title, publishers = excluded.publishers, published_date = excluded.published_date,
        cover_url = excluded.cover_url, provider = excluded.provider, provider_id = excluded.provider_id,
        score = excluded.score, suggested = true, rank = 1, evidence = excluded.evidence,
        selection_state = excluded.selection_state, confidence = excluded.confidence,
        algorithm_version = excluded.algorithm_version, score_breakdown = excluded.score_breakdown,
        work_confidence = excluded.work_confidence, edition_confidence = excluded.edition_confidence,
        cover_confidence = excluded.cover_confidence, auto_accept = excluded.auto_accept,
        last_evaluated_at = now();
    end if;

    if target_cover_url is null then
      missing_cover_count := missing_cover_count + 1;
      continue;
    end if;

    update public.book_observations
    set status = 'cover_provided', isbn_text = target_isbn,
        raw_payload = raw_payload || jsonb_build_object('coverResolution', 'assistant-supplied')
    where id = target_observation_id;

    if target_isbn is not null then
      insert into public.editions(isbn13, title, publishers, published_date, language, cover_url, provider, provider_id, metadata, metadata_status, updated_at)
      values(
        target_isbn, target_title,
        case when nullif(book ->> 'publisher', '') is null then '{}'::text[] else array[book ->> 'publisher'] end,
        nullif(book ->> 'publicationYear', ''), nullif(book ->> 'language', ''), target_cover_url,
        'assistant-web', 'assistant:' || target_import_id || ':' || book_index,
        jsonb_build_object('source', 'connected-assistant', 'coverUrl', target_cover_url, 'notes', book -> 'notes'),
        'algorithm_selected', now()
      )
      on conflict(isbn13) do update set
        title = coalesce(public.editions.title, excluded.title),
        publishers = case when cardinality(public.editions.publishers) = 0 then excluded.publishers else public.editions.publishers end,
        published_date = coalesce(public.editions.published_date, excluded.published_date),
        language = coalesce(public.editions.language, excluded.language),
        cover_url = excluded.cover_url,
        metadata = public.editions.metadata || excluded.metadata,
        updated_at = now()
      returning id into target_edition_id;

      update public.copies
      set edition_id = target_edition_id, cover_url = target_cover_url,
          cover_source = 'assistant-supplied', edition_verification_state = 'algorithm_selected', updated_at = now()
      where id = target_copy_id;

      update public.cover_resolution_jobs
      set status = 'completed', source = 'assistant-supplied', error = null,
          completed_at = now(), next_retry_at = null, updated_at = now()
      where isbn13 = target_isbn;
    else
      update public.copies
      set cover_url = target_cover_url, cover_source = 'assistant-supplied', updated_at = now()
      where id = target_copy_id;
    end if;

    delete from public.copy_cover_selections where copy_id = target_copy_id;
  end loop;

  if missing_cover_count = 0 then
    update public.manual_genai_imports
    set matching_status = 'completed', matched_count = supplied_isbn_count,
        unresolved_count = 0, retryable_count = 0, matching_error = null,
        matching_started_at = now(), matching_completed_at = now(), next_retry_at = null
    where id = target_import_id;
  end if;

  return result || jsonb_build_object('backendFallbackBooks', missing_cover_count);
end;
$$;

revoke all on function private.import_manual_genai_books(uuid, uuid, jsonb)
  from public, anon, authenticated;

-- Connected updates use the researched ISBN as their strongest deduplication key.
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
    target_isbn := coalesce(nullif(book->>'isbn', ''), nullif(book->>'visibleIsbn', ''));
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
