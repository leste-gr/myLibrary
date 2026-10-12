create table public.ingestion_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  runner text not null,
  status text not null default 'processing',
  stage2_imports integer not null default 0,
  stage3_covers integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ingestion_pipeline_run_status_check check (status in ('processing', 'completed', 'failed')),
  constraint ingestion_pipeline_run_counts_check check (stage2_imports >= 0 and stage3_covers >= 0)
);

alter table public.ingestion_pipeline_runs enable row level security;
revoke all on public.ingestion_pipeline_runs from public, anon, authenticated;
create index ingestion_pipeline_runs_started_idx on public.ingestion_pipeline_runs(started_at desc);

