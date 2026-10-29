-- Search-selected covers have no model verification. Preserve existing covers.
create or replace function public.finish_gemini_cover_job(target_job_id uuid,lease_token uuid,result jsonb) returns text
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
      values((case when result->>'provider'='serper' then 'serper:' else 'gemini:' end)||job.copy_id||':'||encode(extensions.digest(cover,'sha256'),'hex'),'source_page',cover,result->>'sourceUrl',case when result->>'provider'='serper' then 'serper' else 'gemini' end,result,case when result->>'provider'='serper' then 'provisional' else 'algorithm_verified' end)
      on conflict(canonical_key) do update set evidence=excluded.evidence,updated_at=now() returning id into asset;
    update public.copies set cover_url=cover,cover_source=case when result->>'provider'='serper' then 'serper' else 'gemini' end,updated_at=now() where id=job.copy_id;
    insert into public.copy_cover_selections(copy_id,cover_asset_id,usage_scope,decision_source)
      values(job.copy_id,asset,'representative','algorithm') on conflict(copy_id) do update set cover_asset_id=excluded.cover_asset_id,usage_scope='representative',decision_source='algorithm',selected_by=null,selected_at=now();
    insert into public.audit_events(copy_id,actor_id,action,previous_value,new_value)
      values(job.copy_id,auth.uid(),'gemini_cover','{"cover_url":null}',jsonb_build_object('cover_url',cover));
    final_status:='found';
  end if;
  update public.gemini_cover_jobs set status=final_status,outcome=result,lease=null where id=job.id;
  return final_status;
end; $$;

