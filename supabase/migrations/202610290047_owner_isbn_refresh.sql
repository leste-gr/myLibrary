-- Manual ISBN submission publishes metadata for this copy and replaces its cover.
create function public.apply_owned_isbn_refresh(target_copy_id uuid,target_isbn text,result jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare asset uuid; cover text:=nullif(result->>'coverUrl',''); old_cover text;
begin
 if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Browser ownership required.'; end if;
 select cover_url into old_cover from public.copies where id=target_copy_id and public.owns_collection(collection_id) for update;
 if not found then raise exception 'Collection ownership required.'; end if;
 perform 1 from public.copy_drafts d join public.editions e on e.id=d.edition_id
 where d.copy_id=target_copy_id and d.created_by=auth.uid() and e.isbn13=target_isbn
 and nullif(d.edition_metadata->>'title','') is not null and jsonb_array_length(coalesce(d.edition_metadata->'authors','[]'))>0 for update of d;
 if not found then raise exception 'ISBN draft changed or metadata is incomplete.'; end if;
 if cover is not null and (length(cover)>2048 or cover !~ '^https://[A-Za-z0-9.-]+(:443)?/[^[:space:]]*$'
 or lower(split_part(split_part(cover,'://',2),'/',1)) ~ '^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|0\.)') then raise exception 'Invalid cover URL.'; end if;
 perform private.publish_copy_draft(target_copy_id);
 update public.copies set cover_url=cover,cover_source=case when cover is not null then 'serper' else null end,
 owner_cover_path=null,updated_at=now() where id=target_copy_id;
 delete from public.copy_cover_selections where copy_id=target_copy_id;
 if cover is not null then
 insert into public.cover_assets(canonical_key,source_type,source_url,source_page_url,provider,evidence,verification_status)
 values('serper-isbn:'||target_copy_id||':'||target_isbn||':'||encode(extensions.digest(cover,'sha256'),'hex'),'source_page',cover,result->>'sourceUrl','serper',result,'provisional')
 on conflict(canonical_key) do update set evidence=excluded.evidence returning id into asset;
 insert into public.copy_cover_selections(copy_id,cover_asset_id,usage_scope,decision_source) values(target_copy_id,asset,'representative','algorithm');
 end if;
 insert into public.audit_events(copy_id,actor_id,action,previous_value,new_value)
 values(target_copy_id,auth.uid(),'isbn_cover_refresh',jsonb_build_object('cover_url',old_cover),result);
end; $$;
revoke all on function public.apply_owned_isbn_refresh(uuid,text,jsonb) from public,anon;
grant execute on function public.apply_owned_isbn_refresh(uuid,text,jsonb) to authenticated;
