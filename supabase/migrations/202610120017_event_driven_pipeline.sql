do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end;
$$;

create or replace function private.dispatch_ingestion_pipeline()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    return new;
  end if;
  perform net.http_post(
    url := 'https://khhdjbqaakxqpscilshu.supabase.co/functions/v1/pipeline-dispatch',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('importId', new.id),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists dispatch_ingestion_pipeline_after_insert on public.manual_genai_imports;
create trigger dispatch_ingestion_pipeline_after_insert
after insert on public.manual_genai_imports
for each row when (new.matching_status = 'pending')
execute function private.dispatch_ingestion_pipeline();

revoke all on function private.dispatch_ingestion_pipeline() from public, anon, authenticated;

