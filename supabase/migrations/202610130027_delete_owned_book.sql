create function public.delete_owned_book(target_copy_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owned_copy_id uuid;
  affected_work_id uuid;
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then
    raise exception 'Browser sign-in required.';
  end if;

  select copies.id, copies.work_id
  into owned_copy_id, affected_work_id
  from public.copies
  join public.collections on collections.id = copies.collection_id
  where copies.id = target_copy_id
    and collections.owner_id = auth.uid()
  for update of copies;

  if owned_copy_id is null then
    raise exception 'Book not found.';
  end if;

  delete from public.copies where id = owned_copy_id;

  delete from public.works
  where id = affected_work_id
    and not exists (
      select 1 from public.copies where copies.work_id = affected_work_id
    );

  return true;
end;
$$;

revoke all on function public.delete_owned_book(uuid) from public, anon;
grant execute on function public.delete_owned_book(uuid) to authenticated;
