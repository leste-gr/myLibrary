-- Every missing cover, including a newly ingested pending book, has an image.
-- The placeholder remains a presentation fallback, never a stored found cover.
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
  case when c.cover_status = 'cover_not_found' then '/covers/cover-not-found.svg'
    else coalesce(nullif(btrim(c.cover_url), ''), nullif(btrim(e.cover_url), ''), '/covers/cover-not-found.svg') end as cover_url,
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
