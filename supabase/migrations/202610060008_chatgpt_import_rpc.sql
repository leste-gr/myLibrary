create or replace function public.consume_chatgpt_import(target_code_hash text, detected_books jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  import_session public.chatgpt_import_sessions%rowtype;
  book jsonb;
  book_index integer;
  target_work_id uuid;
  target_copy_id uuid;
  first_display_order integer;
  target_legacy_id text;
  imported_count integer;
begin
  if jsonb_typeof(detected_books) <> 'array' then raise exception 'books must be an array'; end if;
  imported_count := jsonb_array_length(detected_books);
  if imported_count < 1 or imported_count > 100 then raise exception 'books must contain between 1 and 100 items'; end if;

  select * into import_session
  from public.chatgpt_import_sessions
  where code_hash = target_code_hash
    and status in ('pending', 'failed')
    and expires_at > now()
  for update;
  if not found then raise exception 'Import code is invalid, expired, or already used.'; end if;

  update public.chatgpt_import_sessions set status = 'processing', processing_error = null where id = import_session.id;
  select coalesce(max(display_order), 0) + 1 into first_display_order from public.copies where collection_id = import_session.collection_id;

  for book, book_index in
    select value, (ordinality - 1)::integer from jsonb_array_elements(detected_books) with ordinality
  loop
    insert into public.works(external_key, title, author, normalized_title, normalized_author, updated_at)
    values(
      'chatgpt:' || import_session.id || ':' || book_index,
      book ->> 'title',
      book ->> 'author',
      lower(regexp_replace(book ->> 'title', '[^[:alnum:]]+', ' ', 'g')),
      lower(regexp_replace(book ->> 'author', '[^[:alnum:]]+', ' ', 'g')),
      now()
    )
    on conflict(external_key) do update set
      title = excluded.title,
      author = excluded.author,
      normalized_title = excluded.normalized_title,
      normalized_author = excluded.normalized_author,
      updated_at = now()
    returning id into target_work_id;

    target_legacy_id := 'C-' || upper(left(import_session.id::text, 8)) || '-' || lpad((book_index + 1)::text, 3, '0');
    insert into public.copies(collection_id, legacy_id, work_id, display_order, category, language, publisher, published)
    values(import_session.collection_id, target_legacy_id, target_work_id, first_display_order + book_index, 'Αταξινόμητα', coalesce(nullif(book ->> 'language', ''), 'Άγνωστη'), nullif(book ->> 'publisher', ''), true)
    on conflict(collection_id, legacy_id) do update set
      work_id = excluded.work_id,
      language = excluded.language,
      publisher = excluded.publisher,
      updated_at = now()
    returning id into target_copy_id;

    insert into public.book_observations(collection_id, copy_id, chatgpt_import_session_id, detection_index, source_type, title_text, author_text, publisher_text, isbn_text, language_hint, confidence, status, raw_payload)
    values(import_session.collection_id, target_copy_id, import_session.id, book_index, 'chatgpt_shelfie', book ->> 'title', book ->> 'author', nullif(book ->> 'publisher', ''), nullif(book ->> 'visibleIsbn', ''), nullif(book ->> 'language', ''), (book ->> 'confidence')::numeric, 'ready_for_matching', jsonb_build_object('source', 'chatgpt-account', 'detection_index', book_index))
    on conflict(chatgpt_import_session_id, detection_index) where chatgpt_import_session_id is not null and detection_index is not null
    do update set
      copy_id = excluded.copy_id,
      title_text = excluded.title_text,
      author_text = excluded.author_text,
      publisher_text = excluded.publisher_text,
      isbn_text = excluded.isbn_text,
      language_hint = excluded.language_hint,
      confidence = excluded.confidence,
      raw_payload = excluded.raw_payload;

    if nullif(book ->> 'visibleIsbn', '') is not null then
      insert into public.edition_candidates(copy_id, isbn13, title, publishers, cover_url, provider, provider_id, score, suggested, rank, evidence, selection_state, confidence, algorithm_version, score_breakdown, provider_count, last_evaluated_at)
      values(target_copy_id, book ->> 'visibleIsbn', book ->> 'title', case when nullif(book ->> 'publisher', '') is null then '{}'::text[] else array[book ->> 'publisher'] end, '/api/covers/' || (book ->> 'visibleIsbn'), 'chatgpt-visible-isbn', 'chatgpt:' || import_session.id || ':' || book_index, 1200, true, 1, '["visible valid ISBN transcribed by ChatGPT"]'::jsonb, 'alternative', (book ->> 'confidence')::numeric, 'chatgpt-import-v1', '{"visible_isbn":1200}'::jsonb, 1, now())
      on conflict(copy_id, isbn13) do update set
        title = excluded.title,
        publishers = excluded.publishers,
        score = excluded.score,
        rank = 1,
        confidence = excluded.confidence,
        last_evaluated_at = now();
    end if;
  end loop;

  update public.chatgpt_import_sessions
  set status = 'completed', detected_book_count = imported_count, consumed_at = now(), processing_error = null
  where id = import_session.id;

  return jsonb_build_object('sessionId', import_session.id, 'collectionId', import_session.collection_id, 'imported', imported_count);
exception when others then
  if import_session.id is not null then
    update public.chatgpt_import_sessions set status = 'failed', processing_error = left(sqlerrm, 2000) where id = import_session.id;
  end if;
  raise;
end;
$$;

revoke all on function public.consume_chatgpt_import(text, jsonb) from public;
grant execute on function public.consume_chatgpt_import(text, jsonb) to anon, authenticated;
