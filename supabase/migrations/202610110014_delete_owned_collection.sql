create function public.delete_owned_collection(target_collection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare owned_id uuid; affected_work_ids uuid[];
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Browser sign-in required.'; end if;
  select id into owned_id from public.collections
  where id = target_collection_id and owner_id = auth.uid() for update;
  if owned_id is null then raise exception 'Collection not found.'; end if;
  select coalesce(array_agg(distinct work_id), '{}'::uuid[]) into affected_work_ids
  from public.copies where collection_id = owned_id;
  delete from public.collections where id = owned_id;
  delete from public.works work
  where work.id = any(affected_work_ids)
    and not exists (select 1 from public.copies copy where copy.work_id = work.id);
  return true;
end;
$$;
revoke all on function public.delete_owned_collection(uuid) from public, anon;
grant execute on function public.delete_owned_collection(uuid) to authenticated;
