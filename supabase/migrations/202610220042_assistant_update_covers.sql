-- Stable keyset traversal: filling a cover must not shift an offset-based queue.
create function public.assistant_list_missing_covers(target_collection_id uuid,
  after_id uuid default null, page_limit integer default 3)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare books jsonb; total_missing integer; collection_slug text; has_more boolean;
begin
  if auth.uid() is null or not public.assistant_connection_allowed()
    or not public.owns_collection(target_collection_id) then raise exception 'Assistant access denied.'; end if;
  if page_limit is null or page_limit not between 1 and 5 then raise exception 'Invalid cover-search page size.'; end if;
  select slug into collection_slug from public.collections where id=target_collection_id;
  select count(*) into total_missing from public.copies
    where collection_id=target_collection_id and cover_url is null and owner_cover_path is null;
  with candidates as (
    select c.id,c.legacy_id,w.title,w.author,c.publisher,c.language,w.series,c.volume,
      (select raw_payload->'authors' from public.book_observations o where o.copy_id=c.id
        and jsonb_typeof(raw_payload->'authors')='array' order by o.created_at desc,o.id desc limit 1) as authors
    from public.copies c join public.works w on w.id=c.work_id
    where c.collection_id=target_collection_id and c.cover_url is null and c.owner_cover_path is null
      and (after_id is null or c.id>after_id)
    order by c.id limit page_limit+1
  ), numbered as (select *,row_number() over(order by id) as n from candidates)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'legacyId',legacy_id,'title',title,
    'authors',coalesce(authors,to_jsonb(string_to_array(author,','))), 'publisher',publisher,
    'language',language,'series',series,'volume',volume) order by id) filter(where n<=page_limit),'[]'),
    count(*)>page_limit into books,has_more from numbered;
  return jsonb_build_object('collectionId',target_collection_id,'slug',collection_slug,
    'totalMissing',total_missing,'books',books,'hasMore',has_more);
end;
$$;
revoke all on function public.assistant_list_missing_covers(uuid,uuid,integer) from public,anon;
grant execute on function public.assistant_list_missing_covers(uuid,uuid,integer) to authenticated;

-- Recheck consent, ownership and cover state after the online search. A concurrent
-- worker or owner upload wins; this operation must never replace their image.
create function public.assistant_set_missing_cover(target_collection_id uuid,target_copy_id uuid,
  cover_url text,source_page_url text default null,search_evidence jsonb default '{}')
returns boolean language plpgsql security definer set search_path = public as $$
declare asset uuid; current_copy public.copies%rowtype; host text;
begin
  if auth.uid() is null or not public.assistant_connection_allowed()
    or not public.owns_collection(target_collection_id) then raise exception 'Assistant access denied.'; end if;
  if cover_url is null or char_length(cover_url)>2048
    or cover_url !~ '^https://[A-Za-z0-9.-]+(:443)?(/[^[:space:]]*)?$' then raise exception 'Invalid cover URL.'; end if;
  host:=lower(split_part(split_part(cover_url,'://',2),'/',1));
  if host ~ '^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.)'
    or host ~ '\.(localhost|local)(:443)?$' then raise exception 'Invalid cover URL.'; end if;
  if source_page_url is not null and (char_length(source_page_url)>2048 or source_page_url !~ '^https://[^[:space:]]+$')
    or jsonb_typeof(search_evidence) is distinct from 'object' or octet_length(search_evidence::text)>8000 then
    raise exception 'Invalid cover evidence.';
  end if;
  select * into current_copy from public.copies where id=target_copy_id and collection_id=target_collection_id for update;
  if not found then raise exception 'Book not found in this collection.'; end if;
  if current_copy.cover_url is not null or current_copy.owner_cover_path is not null then return false; end if;
  insert into public.cover_assets(canonical_key,source_type,source_url,source_page_url,provider,evidence,verification_status)
    values('assistant-search:'||target_copy_id||':'||encode(extensions.digest(cover_url,'sha256'),'hex'),
      'source_page',cover_url,source_page_url,'assistant-cover-search',search_evidence,'algorithm_verified')
    on conflict(canonical_key) do update set evidence=excluded.evidence,source_page_url=excluded.source_page_url,updated_at=now()
    returning id into asset;
  update public.copies set cover_url=assistant_set_missing_cover.cover_url,cover_source='assistant-cover-search',updated_at=now()
    where id=target_copy_id;
  insert into public.copy_cover_selections(copy_id,cover_asset_id,usage_scope,decision_source)
    values(target_copy_id,asset,'representative','algorithm')
    on conflict(copy_id) do update set cover_asset_id=excluded.cover_asset_id,usage_scope='representative',
      decision_source='algorithm',selected_by=null,selected_at=now();
  insert into public.audit_events(copy_id,actor_id,action,previous_value,new_value)
    values(target_copy_id,auth.uid(),'update_cover','{"cover_url":null}',jsonb_build_object('cover_url',cover_url,'source_page_url',source_page_url));
  return true;
end;
$$;
revoke all on function public.assistant_set_missing_cover(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.assistant_set_missing_cover(uuid,uuid,text,text,jsonb) to authenticated;
