-- Multiple tags are authoritative. Retain the first tag in the legacy column for
-- old integrations during rollout; no books, loans or bibliographic data are removed.
alter table public.copies add column categories text[] not null default '{}';
alter table public.copies add constraint copies_categories_limit check(cardinality(categories)<=8);
create index copies_categories_gin on public.copies using gin(categories);

create function private.normalize_category_tags(tags text[])
returns text[] language plpgsql immutable set search_path=public as $$
declare tag text; normalized text; result text[]:='{}';
begin
  if tags is null or cardinality(tags)>8 or coalesce(array_ndims(tags),1)>1 then
    raise exception 'Invalid categories array.';
  end if;
  foreach tag in array tags loop
    if tag is null or char_length(btrim(tag)) not between 1 and 80 then
      raise exception 'Category tags must contain 1-80 characters.';
    end if;
    normalized:=lower(regexp_replace(btrim(tag),'[[:space:]]+',' ','g'));
    normalized:=case normalized
      when 'children''s books' then 'Children''s Books' when 'children’s books' then 'Children''s Books'
      when 'sci-fi' then 'Science Fiction' when 'sci fi' then 'Science Fiction' when 'science-fiction' then 'Science Fiction'
      when 'non-fiction' then 'Nonfiction' when 'non fiction' then 'Nonfiction'
      when 'rpg' then 'Tabletop Roleplaying' when 'rpgs' then 'Tabletop Roleplaying' when 'role-playing games' then 'Tabletop Roleplaying'
      when 'comics' then 'Comics & Graphic Novels' when 'graphic novel' then 'Comics & Graphic Novels' when 'graphic novels' then 'Comics & Graphic Novels'
      when 'αταξινόμητα' then 'Uncategorized' when 'uncategorised' then 'Uncategorized'
      else initcap(normalized) end;
    if not normalized=any(result) then result:=array_append(result,normalized); end if;
  end loop;
  return result;
end;
$$;
revoke all on function private.normalize_category_tags(text[]) from public,anon,authenticated;

create function private.sync_copy_category_tags()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (tg_op='INSERT' and cardinality(new.categories)=0
      or tg_op='UPDATE' and new.categories is not distinct from old.categories and new.category is distinct from old.category)
    and nullif(btrim(new.category),'') is not null and lower(btrim(new.category)) not in ('αταξινόμητα','uncategorized','uncategorised') then
    new.categories:=array[new.category];
  end if;
  new.categories:=private.normalize_category_tags(new.categories);
  new.category:=coalesce(new.categories[1],'Αταξινόμητα');
  return new;
end;
$$;
revoke all on function private.sync_copy_category_tags() from public,anon,authenticated;
create trigger copy_category_tags before insert or update of category,categories on public.copies
for each row execute function private.sync_copy_category_tags();
update public.copies set categories=case when lower(btrim(category)) in ('αταξινόμητα','uncategorized','uncategorised','') then '{}'::text[] else array[category] end;

-- Import paths already preserve each client's full book in raw_payload. Persist
-- its explicit tags atomically for MCP, manual JSON, and owner ISBN submissions.
create function private.import_observation_category_tags()
returns trigger language plpgsql security definer set search_path=public as $$
declare tags jsonb; parsed text[];
begin
  if tg_op='UPDATE' and new.copy_id is not distinct from old.copy_id
    and new.raw_payload->'categories' is not distinct from old.raw_payload->'categories' then return new; end if;
  if not new.raw_payload ? 'categories' then return new; end if;
  tags:=new.raw_payload->'categories';
  if jsonb_typeof(tags) is distinct from 'array' then raise exception 'categories must be an array.'; end if;
  if jsonb_array_length(tags)>8 or exists(select 1 from jsonb_array_elements(tags) tag
    where jsonb_typeof(tag) is distinct from 'string' or char_length(btrim(tag#>>'{}')) not between 1 and 80) then
    raise exception 'categories must contain at most 8 non-empty tags of 1-80 characters.';
  end if;
  select coalesce(array_agg(value order by n),'{}') into parsed from jsonb_array_elements_text(tags) with ordinality as t(value,n);
  if new.copy_id is not null then
    update public.copies set categories=parsed where id=new.copy_id and collection_id=new.collection_id;
  end if;
  return new;
end;
$$;
revoke all on function private.import_observation_category_tags() from public,anon,authenticated;
create trigger observation_category_tags after insert or update of copy_id,raw_payload on public.book_observations
for each row execute function private.import_observation_category_tags();

create or replace view public.public_catalogue with (security_invoker=true) as
select c.legacy_id,c.display_order,w.title,w.author,w.contributors,w.series,w.subseries,
  c.volume,c.language,c.category,coalesce(e.publishers[1],c.publisher) as publisher,c.notes,
  case when c.cover_status='cover_not_found' then '/covers/cover-not-found.svg'
    else coalesce(nullif(btrim(c.cover_url),''),nullif(btrim(e.cover_url),''),'/covers/cover-not-found.svg') end as cover_url,
  c.cover_source,e.isbn13,c.collection_id,collections.slug as collection_slug,collections.name as collection_name,
  c.reading_status,c.categories
from public.copies c join public.collections on collections.id=c.collection_id
join public.works w on w.id=c.work_id left join public.editions e on e.id=c.edition_id
where c.published and collections.is_public;
grant select on public.public_catalogue to anon,authenticated;

-- Owner-scoped MCP tools for browsing books and creating import destinations.
create or replace function public.assistant_list_collection_books(
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
        'language', listed.language,
        'categories', listed.categories
      ) order by listed.display_order)
      from (
        select c.legacy_id, c.display_order, w.title, w.author, e.isbn13,
               w.series, c.volume, c.language, c.categories
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

