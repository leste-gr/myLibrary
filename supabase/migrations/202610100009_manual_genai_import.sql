create table public.manual_genai_imports (
  id uuid primary key,
  collection_id uuid not null references public.collections(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  schema_version text not null,
  payload_checksum text not null,
  book_count integer not null,
  created_at timestamptz not null default now(),
  constraint manual_genai_schema_check check (schema_version = 'mylibrary.shelfie.v1'),
  constraint manual_genai_book_count_check check (book_count between 1 and 100),
  unique(collection_id, payload_checksum)
);

alter table public.manual_genai_imports enable row level security;
grant select on public.manual_genai_imports to authenticated;
create policy "Owners read manual GenAI imports" on public.manual_genai_imports for select to authenticated
using (owner_id = auth.uid() and public.owns_collection(collection_id));

alter table public.book_observations drop constraint if exists observation_source_type_check;
alter table public.book_observations
  add constraint observation_source_type_check check (source_type in ('shelfie', 'chatgpt_shelfie', 'manual_genai_json', 'barcode', 'cover_photo', 'copyright_page', 'manual', 'legacy_import')),
  add column manual_genai_import_id uuid references public.manual_genai_imports(id) on delete set null;

create unique index book_observations_manual_genai_order_unique
  on public.book_observations(manual_genai_import_id, detection_index)
  where manual_genai_import_id is not null and detection_index is not null;

create or replace function public.import_manual_genai_books(target_collection_id uuid, target_import_id uuid, payload jsonb)
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
  target_isbn text;
  imported_count integer;
  checksum text;
  existing_import public.manual_genai_imports%rowtype;
  seen_positions integer[] := '{}';
  target_position integer;
  isbn_checksum integer;
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
    target_isbn := nullif(book ->> 'visibleIsbn', '');
    if target_isbn is not null and target_isbn !~ '^97[89][0-9]{10}$' then
      raise exception 'visibleIsbn must be null or a canonical ISBN-13.';
    end if;
    if target_isbn is not null then
      select sum(substring(target_isbn from digit_index for 1)::integer * case when digit_index % 2 = 0 then 3 else 1 end)
      into isbn_checksum
      from generate_series(1, 12) digit_index;
      if (isbn_checksum + right(target_isbn, 1)::integer) % 10 <> 0 then
        raise exception 'visibleIsbn has an invalid check digit.';
      end if;
    end if;
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
    values(target_collection_id, target_copy_id, target_import_id, book_index, 'manual_genai_json', target_title, target_author, nullif(book ->> 'publisher', ''), target_isbn, nullif(book ->> 'language', ''), nullif(book ->> 'editionStatement', ''), (book ->> 'confidence')::numeric, 'ready_for_matching', book || jsonb_build_object('source', 'manual-genai-json', 'schemaVersion', payload ->> 'schemaVersion'))
    on conflict(manual_genai_import_id, detection_index) where manual_genai_import_id is not null and detection_index is not null
    do update set copy_id = excluded.copy_id, title_text = excluded.title_text, author_text = excluded.author_text, publisher_text = excluded.publisher_text, isbn_text = excluded.isbn_text, language_hint = excluded.language_hint, format_hint = excluded.format_hint, confidence = excluded.confidence, raw_payload = excluded.raw_payload;

    if target_isbn is not null then
      insert into public.edition_candidates(copy_id, isbn13, title, publishers, published_date, cover_url, provider, provider_id, score, suggested, rank, evidence, selection_state, confidence, algorithm_version, score_breakdown, provider_count, last_evaluated_at)
      values(target_copy_id, target_isbn, target_title, case when nullif(book ->> 'publisher', '') is null then '{}'::text[] else array[book ->> 'publisher'] end, nullif((book ->> 'publicationYear'), ''), '/api/covers/' || target_isbn, 'manual-visible-isbn', 'manual-genai:' || target_import_id || ':' || book_index, 1200, true, 1, '["visible ISBN supplied in manually uploaded JSON"]'::jsonb, 'alternative', (book ->> 'confidence')::numeric, 'manual-genai-import-v1', '{"visible_isbn":1200}'::jsonb, 1, now())
      on conflict(copy_id, isbn13) do update set title = excluded.title, publishers = excluded.publishers, published_date = excluded.published_date, score = excluded.score, suggested = true, rank = 1, confidence = excluded.confidence, last_evaluated_at = now();
    end if;
  end loop;

  return jsonb_build_object('importId', target_import_id, 'collectionId', target_collection_id, 'imported', imported_count, 'duplicate', false);
end;
$$;

revoke all on function public.import_manual_genai_books(uuid, uuid, jsonb) from public, anon;
grant execute on function public.import_manual_genai_books(uuid, uuid, jsonb) to authenticated;
