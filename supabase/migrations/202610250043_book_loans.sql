-- Loan contacts are private owner data, separate from public catalogue views.
create table public.book_loans (
  copy_id uuid primary key references public.copies(id) on delete cascade,
  collection_id uuid not null references public.collections(id) on delete cascade,
  status text not null check (status in ('loaned_out','loaned_in')),
  person_name text check (person_name is null or (char_length(person_name) between 1 and 120 and person_name=btrim(person_name))),
  updated_at timestamptz not null default now()
);
create index book_loans_collection_idx on public.book_loans(collection_id,copy_id);
alter table public.book_loans enable row level security;
revoke all on public.book_loans from public,anon,authenticated;
grant select on public.book_loans to authenticated;
create policy "Browser owners read their own loan contacts" on public.book_loans
for select to authenticated using (auth.jwt()->>'client_id' is null and public.owns_collection(collection_id));

create function public.set_owned_book_loan(target_collection_id uuid,target_legacy_id text,
  new_status text,contact_name text default null)
returns void language plpgsql security definer set search_path=public as $$
declare target_copy uuid; cleaned_name text:=nullif(btrim(contact_name),'');
begin
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then raise exception 'Browser sign-in required.'; end if;
  if new_status is null or new_status not in ('none','loaned_out','loaned_in') then raise exception 'Invalid loan status.'; end if;
  if char_length(cleaned_name)>120 then raise exception 'Loan contact name is too long.'; end if;
  select id into target_copy from public.copies where collection_id=target_collection_id
    and legacy_id=target_legacy_id and public.owns_collection(target_collection_id) for update;
  if not found then raise exception 'Book not found or collection ownership required.'; end if;
  if new_status='none' then
    delete from public.book_loans where copy_id=target_copy;
  else
    insert into public.book_loans(copy_id,collection_id,status,person_name)
      values(target_copy,target_collection_id,new_status,cleaned_name)
      on conflict(copy_id) do update set status=excluded.status,person_name=excluded.person_name,updated_at=now();
  end if;
end;
$$;
revoke all on function public.set_owned_book_loan(uuid,text,text,text) from public,anon;
grant execute on function public.set_owned_book_loan(uuid,text,text,text) to authenticated;
