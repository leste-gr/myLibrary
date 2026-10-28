-- Browser-owned, resumable per-book Gemini tasks. Photos are never stored.
create table public.gemini_cover_jobs (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.manual_genai_imports(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  copy_id uuid not null references public.copies(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','running','found','not_found','failed','skipped')),
  attempts integer not null default 0,
  lease uuid, started_at timestamptz,
  created_at timestamptz not null default now(),
  outcome jsonb not null default '{}',
  unique(import_id,copy_id)
);
alter table public.gemini_cover_jobs enable row level security;
grant select on public.gemini_cover_jobs to authenticated;
create policy "Browser owner reads Gemini progress" on public.gemini_cover_jobs for select to authenticated
  using(auth.jwt()->>'client_id' is null and public.owns_collection(collection_id));

create function public.prepare_gemini_cover_jobs(target_import_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare collection uuid;
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Browser ownership required.'; end if;
  select m.collection_id into collection from public.manual_genai_imports m
    where m.id=target_import_id and m.owner_id=auth.uid() and public.owns_collection(m.collection_id);
  if collection is null then raise exception 'Import not found.'; end if;
  insert into public.gemini_cover_jobs(import_id,collection_id,copy_id)
    select distinct target_import_id,collection,c.id from public.book_observations o join public.copies c on c.id=o.copy_id
    where o.manual_genai_import_id=target_import_id and c.collection_id=collection and c.cover_url is null and c.owner_cover_path is null
    on conflict(import_id,copy_id) do nothing;
end; $$;

create function public.claim_gemini_cover_job(target_import_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.gemini_cover_jobs; token uuid:=gen_random_uuid(); book jsonb;
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null or not exists(
    select 1 from public.manual_genai_imports m where m.id=target_import_id and m.owner_id=auth.uid() and public.owns_collection(m.collection_id)
  ) then raise exception 'Browser ownership required.'; end if;
  update public.gemini_cover_jobs set status='failed',lease=null,outcome='{"error":"Cover search interrupted. Retry limit reached."}' where import_id=target_import_id and status='running' and attempts>=3 and started_at<now()-interval '5 minutes';
  select * into job from public.gemini_cover_jobs where import_id=target_import_id and attempts<3
    and (status='pending' or (status='running' and started_at<now()-interval '5 minutes'))
    order by id for update skip locked limit 1;
  if job.id is null then return null; end if;
  update public.gemini_cover_jobs set status='running',attempts=attempts+1,lease=token,started_at=now() where id=job.id;
  select jsonb_build_object('title',w.title,'author',w.author,'language',c.language,'publisher',c.publisher,'series',w.series,'volume',c.volume,
    'hasCover',c.cover_url is not null or c.owner_cover_path is not null) into book
    from public.copies c join public.works w on w.id=c.work_id where c.id=job.copy_id;
  return jsonb_build_object('id',job.id,'lease',token,'book',book);
end; $$;

create function public.finish_gemini_cover_job(target_job_id uuid,lease_token uuid,result jsonb) returns text
language plpgsql security definer set search_path=public as $$
declare job public.gemini_cover_jobs; copy public.copies; cover text:=nullif(result->>'coverUrl',''); asset uuid; final_status text;
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Browser ownership required.'; end if;
  select * into job from public.gemini_cover_jobs where id=target_job_id and public.owns_collection(collection_id) for update;
  if job.id is null or job.lease is distinct from lease_token or job.status<>'running' then raise exception 'Task lease expired.'; end if;
  if jsonb_typeof(result) is distinct from 'object' or octet_length(result::text)>64000 then raise exception 'Invalid task result.'; end if;
  select * into copy from public.copies where id=job.copy_id and collection_id=job.collection_id for update;
  if copy.cover_url is not null or copy.owner_cover_path is not null then final_status:='skipped';
  elsif cover is null then final_status:=case when result->>'error' is not null then 'failed' else 'not_found' end;
  else
    if char_length(cover)>2048 or cover !~ '^https://[A-Za-z0-9.-]+(:443)?/[^[:space:]]*$'
      or lower(split_part(split_part(cover,'://',2),'/',1)) ~ '^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.)' then raise exception 'Invalid cover URL.'; end if;
    insert into public.cover_assets(canonical_key,source_type,source_url,source_page_url,provider,evidence,verification_status)
      values('gemini:'||job.copy_id||':'||encode(extensions.digest(cover,'sha256'),'hex'),'source_page',cover,result->>'sourceUrl','gemini',result,'algorithm_verified')
      on conflict(canonical_key) do update set evidence=excluded.evidence,updated_at=now() returning id into asset;
    update public.copies set cover_url=cover,cover_source='gemini',updated_at=now() where id=job.copy_id;
    insert into public.copy_cover_selections(copy_id,cover_asset_id,usage_scope,decision_source)
      values(job.copy_id,asset,'representative','algorithm') on conflict(copy_id) do update set cover_asset_id=excluded.cover_asset_id,usage_scope='representative',decision_source='algorithm',selected_by=null,selected_at=now();
    insert into public.audit_events(copy_id,actor_id,action,previous_value,new_value)
      values(job.copy_id,auth.uid(),'gemini_cover','{"cover_url":null}',jsonb_build_object('cover_url',cover));
    final_status:='found';
  end if;
  update public.gemini_cover_jobs set status=final_status,outcome=result,lease=null where id=job.id;
  return final_status;
end; $$;

create function public.retry_gemini_cover_jobs(target_import_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Browser ownership required.'; end if;
  update public.gemini_cover_jobs set status='pending',lease=null where import_id=target_import_id
    and public.owns_collection(collection_id) and status in ('failed','not_found') and attempts<3;
end; $$;
revoke all on function public.prepare_gemini_cover_jobs(uuid),public.claim_gemini_cover_job(uuid),public.finish_gemini_cover_job(uuid,uuid,jsonb),public.retry_gemini_cover_jobs(uuid) from public,anon;
grant execute on function public.prepare_gemini_cover_jobs(uuid),public.claim_gemini_cover_job(uuid),public.finish_gemini_cover_job(uuid,uuid,jsonb),public.retry_gemini_cover_jobs(uuid) to authenticated;

-- Reserve these copies for Gemini in the import transaction so the legacy
-- catalogue resolver cannot race the new per-book discovery queue.
create function public.import_gemini_books(target_collection_id uuid,target_import_id uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; actual_import uuid;
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null or not public.owns_collection(target_collection_id) then raise exception 'Browser ownership required.'; end if;
  result:=public.import_manual_genai_books(target_collection_id,target_import_id,payload);
  actual_import:=(result->>'importId')::uuid;
  update public.copies c set cover_status='cover_not_found',cover_completed_at=now()
    where c.collection_id=target_collection_id and c.cover_url is null and c.owner_cover_path is null
      and exists(select 1 from public.book_observations o where o.copy_id=c.id and o.manual_genai_import_id=actual_import);
  perform public.prepare_gemini_cover_jobs(actual_import);
  return result;
end; $$;
revoke all on function public.import_gemini_books(uuid,uuid,jsonb) from public,anon;
grant execute on function public.import_gemini_books(uuid,uuid,jsonb) to authenticated;
