update public.editions
set cover_url = '/api/covers/' || isbn13,
    updated_at = now()
where isbn13 is not null;

update public.edition_candidates
set cover_url = '/api/covers/' || isbn13;

update public.copies as copies
set cover_url = '/api/covers/' || editions.isbn13,
    cover_source = 'isbn-resolver',
    updated_at = now()
from public.editions as editions
where copies.edition_id = editions.id
  and editions.isbn13 is not null;

create or replace view public.public_catalogue
with (security_invoker = true)
as
select
  c.legacy_id,
  c.display_order,
  w.title,
  w.author,
  w.contributors,
  w.series,
  w.subseries,
  c.volume,
  c.language,
  c.category,
  coalesce(e.publishers[1], c.publisher) as publisher,
  c.notes,
  coalesce(e.cover_url, c.cover_url) as cover_url,
  c.cover_source,
  e.isbn13,
  c.collection_id,
  collections.slug as collection_slug,
  collections.name as collection_name
from public.copies c
join public.collections on collections.id = c.collection_id
join public.works w on w.id = c.work_id
left join public.editions e on e.id = c.edition_id
where c.published and collections.is_public;

grant select on public.public_catalogue to anon, authenticated;
