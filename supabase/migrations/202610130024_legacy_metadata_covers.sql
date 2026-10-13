alter table public.metadata_cover_candidates
  drop constraint metadata_cover_provider_check;

alter table public.metadata_cover_candidates
  add constraint metadata_cover_provider_check
  check (provider in ('legacy-library', 'openlibrary', 'google-books'));
