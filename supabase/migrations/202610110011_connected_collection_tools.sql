-- Owner-scoped MCP tools for browsing books and creating import destinations.
create function public.assistant_list_collection_books(
  target_collection_id uuid,
  page_limit integer default 100,
  page_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.assistant_connection_allowed()
     or not public.owns_collection(target_collection_id) then
    raise exception 'Assistant access denied.';
  end if;
  if page_limit not between 1 and 200 or page_offset not between 0 and 100000 then
    raise exception 'Invalid pagination.';
  end if;

  select jsonb_build_object(
    'collectionId', target_collection_id,
    'total', (select count(*) from public.copies where collection_id = target_collection_id and published),
    'offset', page_offset,
    'limit', page_limit,
    'hasMore', (select count(*) > page_offset + page_limit from public.copies where collection_id = target_collection_id and published),
    'books', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', listed.legacy_id,
        'title', listed.title,
        'author', listed.author,
        'isbn13', listed.isbn13,
        'series', listed.series,
        'volume', listed.volume,
        'language', listed.language
      ) order by listed.display_order)
      from (
        select c.legacy_id, c.display_order, w.title, w.author, e.isbn13,
               w.series, c.volume, c.language
        from public.copies c
        join public.works w on w.id = c.work_id
        left join public.editions e on e.id = c.edition_id
        where c.collection_id = target_collection_id and c.published
        order by c.display_order
        limit page_limit offset page_offset
      ) listed
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.assistant_list_collection_books(uuid, integer, integer) from public, anon;
grant execute on function public.assistant_list_collection_books(uuid, integer, integer) to authenticated;

create function public.assistant_create_collection(
  collection_name text,
  collection_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare new_id uuid := gen_random_uuid(); clean_name text := btrim(collection_name);
  clean_description text := nullif(btrim(collection_description), ''); new_slug text;
begin
  if auth.uid() is null or not public.assistant_connection_allowed() then
    raise exception 'Assistant access denied.';
  end if;
  if char_length(clean_name) not between 1 and 120 then raise exception 'Collection name must contain 1–120 characters.'; end if;
  if char_length(coalesce(clean_description, '')) > 1000 then raise exception 'Collection description is too long.'; end if;
  if (select count(*) from public.collections where owner_id = auth.uid()) >= 50 then raise exception 'Collection limit reached.'; end if;

  new_slug := 'collection-' || left(replace(new_id::text, '-', ''), 12);
  insert into public.collections(id, owner_id, slug, name, description)
  values(new_id, auth.uid(), new_slug, clean_name, clean_description);
  return jsonb_build_object('id', new_id, 'name', clean_name, 'slug', new_slug, 'description', clean_description);
end;
$$;
revoke all on function public.assistant_create_collection(text, text) from public, anon;
grant execute on function public.assistant_create_collection(text, text) to authenticated;
