-- Owner-driven single-book creation, separate from shelf-photo ingestion.
alter table public.copies add column creation_request_id uuid;
create unique index copies_creation_request_id_unique on public.copies(creation_request_id)
  where creation_request_id is not null;

create function public.add_owned_isbn_book(target_collection_id uuid, target_isbn text,
  book_metadata jsonb, request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  existing public.copies%rowtype;
  new_copy uuid := gen_random_uuid();
  new_work uuid;
  new_edition uuid;
  new_asset uuid;
  title_text text;
  author_text text;
  publishers text[];
  next_order integer;
  isbn_sum integer;
  cover_path text;
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then
    raise exception 'Browser sign-in required.';
  end if;
  -- Serialize book creation within a collection, including simultaneous scans.
  perform 1 from public.collections where id=target_collection_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Collection ownership required.'; end if;
  if request_id is null or target_isbn is null or target_isbn !~ '^97[89][0-9]{10}$' then
    raise exception 'Invalid ISBN or request.';
  end if;
  select sum(substring(target_isbn from n for 1)::integer * case when n%2=0 then 3 else 1 end)
    into isbn_sum from generate_series(1,12) n;
  if (isbn_sum+right(target_isbn,1)::integer)%10 <> 0 then raise exception 'Invalid ISBN checksum.'; end if;

  select * into existing from public.copies c where c.collection_id=target_collection_id
    and (c.creation_request_id=request_id or c.edition_id in (select e.id from public.editions e where e.isbn13=target_isbn))
    order by c.created_at limit 1;
  if found then return jsonb_build_object('copyId',existing.id,'legacyId',existing.legacy_id,'duplicate',true); end if;

  if octet_length(book_metadata::text)>8000 or jsonb_typeof(book_metadata) is distinct from 'object'
    or jsonb_typeof(book_metadata->'title') is distinct from 'string'
    or char_length(btrim(book_metadata->>'title')) not between 1 and 300
    or jsonb_typeof(book_metadata->'authors') is distinct from 'array'
    or jsonb_typeof(book_metadata->'publishers') is distinct from 'array' then
    raise exception 'Invalid book details.';
  end if;
  if jsonb_array_length(book_metadata->'authors')>10
    or jsonb_array_length(book_metadata->'publishers')>1
    or exists(select 1 from jsonb_array_elements(book_metadata->'authors') a
      where jsonb_typeof(a) is distinct from 'string' or char_length(btrim(a#>>'{}')) not between 1 and 160)
    or exists(select 1 from jsonb_array_elements(book_metadata->'publishers') p
      where jsonb_typeof(p) is distinct from 'string' or char_length(btrim(p#>>'{}')) not between 1 and 200)
    or (book_metadata->'language' is not null and book_metadata->'language'<>'null'::jsonb
      and (jsonb_typeof(book_metadata->'language') is distinct from 'string' or char_length(book_metadata->>'language')>40))
    or (book_metadata->'publishedDate' is not null and book_metadata->'publishedDate'<>'null'::jsonb
      and (jsonb_typeof(book_metadata->'publishedDate') is distinct from 'string' or char_length(book_metadata->>'publishedDate')>80)) then
    raise exception 'Invalid book details.';
  end if;
  title_text := btrim(book_metadata->>'title');
  select coalesce(string_agg(btrim(value),', ' order by position),'Unknown') into author_text
    from jsonb_array_elements_text(book_metadata->'authors') with ordinality as a(value,position);
  select coalesce(array_agg(btrim(value) order by position),'{}'::text[]) into publishers
    from jsonb_array_elements_text(book_metadata->'publishers') with ordinality as p(value,position);

  -- Copies own their reviewed metadata; do not rewrite another owner's edition.
  insert into public.works(external_key,title,author,normalized_title,normalized_author)
    values('owner-isbn-add:'||new_copy,title_text,author_text,
      lower(regexp_replace(title_text,'[^[:alnum:]]+',' ','g')),
      lower(regexp_replace(author_text,'[^[:alnum:]]+',' ','g')))
    returning id into new_work;
  insert into public.editions(isbn13,title,publishers,published_date,language,provider,provider_id,metadata)
    values(target_isbn,title_text,publishers,nullif(book_metadata->>'publishedDate',''),
      nullif(book_metadata->>'language',''),'manual','owner-isbn:'||target_isbn,book_metadata)
    on conflict(isbn13) do update set isbn13=excluded.isbn13 returning id into new_edition;
  insert into public.cover_assets(canonical_key,source_type,source_url,provider,isbn13,verification_status)
    values('owner-isbn:'||target_isbn,'isbn','/api/covers/'||target_isbn,'owner-isbn',target_isbn,'owner_verified')
    on conflict(canonical_key) do update set source_url=excluded.source_url returning id into new_asset;
  cover_path := '/api/cover-assets/'||new_asset;
  select coalesce(max(display_order),0)+1 into next_order from public.copies where collection_id=target_collection_id;
  insert into public.copies(id,collection_id,legacy_id,work_id,edition_id,display_order,category,language,publisher,
    cover_url,cover_source,published,edition_verification_state,edition_confirmed_by,edition_confirmed_at,creation_request_id)
    values(new_copy,target_collection_id,'B-'||new_copy,new_work,new_edition,next_order,'Αταξινόμητα',
      coalesce(nullif(book_metadata->>'language',''),'Unknown'),publishers[1],cover_path,'isbn-resolver',true,
      'owner_confirmed',auth.uid(),now(),request_id);
  insert into public.copy_cover_selections(copy_id,cover_asset_id,usage_scope,decision_source)
    values(new_copy,new_asset,'exact_edition','owner')
    on conflict(copy_id) do update set cover_asset_id=excluded.cover_asset_id,usage_scope=excluded.usage_scope,
      decision_source=excluded.decision_source,selected_at=now();
  insert into public.book_observations(collection_id,copy_id,source_type,title_text,author_text,publisher_text,
    isbn_text,language_hint,confidence,status,raw_payload)
    values(target_collection_id,new_copy,'barcode',title_text,author_text,publishers[1],target_isbn,
      nullif(book_metadata->>'language',''),1,'matched',book_metadata||jsonb_build_object('isbn',target_isbn,'source','owner-isbn-add'));
  insert into public.audit_events(copy_id,actor_id,action,new_value)
    values(new_copy,auth.uid(),'add_isbn_book',jsonb_build_object('isbn',target_isbn,'title',title_text));
  return jsonb_build_object('copyId',new_copy,'legacyId','B-'||new_copy,'duplicate',false);
end;
$$;
revoke all on function public.add_owned_isbn_book(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.add_owned_isbn_book(uuid,text,jsonb,uuid) to authenticated;
