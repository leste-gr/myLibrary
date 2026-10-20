-- One transaction updates the selected copies; invalid or foreign IDs change none.
create function public.set_owned_books_reading_status(target_collection_id uuid,
  target_legacy_ids text[], new_status text)
returns integer language plpgsql security definer set search_path = public as $$
declare selected_count integer; locked_count integer;
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then
    raise exception 'Browser sign-in required.';
  end if;
  if new_status is null or new_status not in ('unread','read','radar') then
    raise exception 'Invalid reading status.';
  end if;
  selected_count := cardinality(target_legacy_ids);
  if selected_count is null or selected_count not between 1 and 1000
    or exists(select 1 from unnest(target_legacy_ids) id where id is null or char_length(id) not between 1 and 200)
    or (select count(distinct id) from unnest(target_legacy_ids) id) <> selected_count then
    raise exception 'Select between 1 and 1000 distinct books.';
  end if;
  perform 1 from public.collections where id=target_collection_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Collection ownership required.'; end if;
  perform 1 from public.copies where collection_id=target_collection_id and legacy_id=any(target_legacy_ids)
    order by id for update;
  get diagnostics locked_count = row_count;
  if locked_count <> selected_count then raise exception 'Some selected books no longer belong to this collection.'; end if;
  update public.copies set reading_status=new_status,updated_at=now()
    where collection_id=target_collection_id and legacy_id=any(target_legacy_ids);
  return selected_count;
end;
$$;
revoke all on function public.set_owned_books_reading_status(uuid,text[],text) from public,anon;
grant execute on function public.set_owned_books_reading_status(uuid,text[],text) to authenticated;
