alter table public.metadata_cover_candidates
  add column source_page_url text,
  add column isbn13 text,
  add column work_confidence numeric,
  add column edition_confidence numeric,
  add column cover_confidence numeric,
  drop constraint metadata_cover_provider_check;

alter table public.metadata_cover_candidates
  add constraint metadata_cover_provider_check check (provider in ('legacy-library', 'openlibrary', 'google-books', 'web-page')),
  add constraint metadata_cover_isbn13_check check (isbn13 is null or isbn13 ~ '^97[89][0-9]{10}$'),
  add constraint metadata_cover_work_confidence_check check (work_confidence is null or work_confidence between 0 and 1),
  add constraint metadata_cover_edition_confidence_check check (edition_confidence is null or edition_confidence between 0 and 1),
  add constraint metadata_cover_cover_confidence_check check (cover_confidence is null or cover_confidence between 0 and 1);
