alter table public.works
  add column observed_title text,
  add column title_resolution_source text,
  add column title_resolution_confidence numeric,
  add column title_resolved_at timestamptz,
  add constraint work_title_resolution_confidence_check check (title_resolution_confidence is null or title_resolution_confidence between 0 and 1);

comment on column public.works.observed_title is 'Literal Stage 1 title retained when a later verified metadata match corrects works.title.';
