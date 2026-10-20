-- Reading progress belongs to each physical copy in its owner's collection.
alter table public.copies add column reading_status text not null default 'unread'
  constraint copies_reading_status_check check (reading_status in ('unread','read','radar'));

create function public.set_owned_book_reading_status(target_collection_id uuid, target_legacy_id text, new_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then
    raise exception 'Browser sign-in required.';
  end if;
  if new_status is null or new_status not in ('unread','read','radar') then
    raise exception 'Invalid reading status.';
  end if;
  update public.copies set reading_status=new_status, updated_at=now()
    where collection_id=target_collection_id and legacy_id=target_legacy_id
      and public.owns_collection(target_collection_id);
  if not found then raise exception 'Book not found or collection ownership required.'; end if;
end;
$$;
revoke all on function public.set_owned_book_reading_status(uuid,text,text) from public,anon;
grant execute on function public.set_owned_book_reading_status(uuid,text,text) to authenticated;

-- Append the public status without changing existing view columns or visibility.
create or replace view public.public_catalogue with (security_invoker = true) as
select c.legacy_id,c.display_order,w.title,w.author,w.contributors,w.series,w.subseries,
  c.volume,c.language,c.category,coalesce(e.publishers[1],c.publisher) as publisher,c.notes,
  case when c.cover_status='cover_not_found' then '/covers/cover-not-found.svg'
    else coalesce(nullif(btrim(c.cover_url),''),nullif(btrim(e.cover_url),''),'/covers/cover-not-found.svg') end as cover_url,
  c.cover_source,e.isbn13,c.collection_id,collections.slug as collection_slug,collections.name as collection_name,
  c.reading_status
from public.copies c join public.collections on collections.id=c.collection_id
join public.works w on w.id=c.work_id left join public.editions e on e.id=c.edition_id
where c.published and collections.is_public;
grant select on public.public_catalogue to anon,authenticated;
