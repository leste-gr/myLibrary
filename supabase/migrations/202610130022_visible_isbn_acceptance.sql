create function private.mark_visible_isbn_auto_accept()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.provider in ('manual-visible-isbn', 'chatgpt-visible-isbn') then
    new.auto_accept := true;
    new.work_confidence := coalesce(new.work_confidence, new.confidence);
    new.edition_confidence := coalesce(new.edition_confidence, new.confidence, 1);
  end if;
  return new;
end;
$$;

create trigger mark_visible_isbn_auto_accept_before_write
before insert or update of provider, confidence, auto_accept on public.edition_candidates
for each row execute function private.mark_visible_isbn_auto_accept();

update public.edition_candidates
set auto_accept = true,
    work_confidence = coalesce(work_confidence, confidence),
    edition_confidence = coalesce(edition_confidence, confidence, 1)
where provider in ('manual-visible-isbn', 'chatgpt-visible-isbn');

revoke all on function private.mark_visible_isbn_auto_accept() from public, anon, authenticated;
