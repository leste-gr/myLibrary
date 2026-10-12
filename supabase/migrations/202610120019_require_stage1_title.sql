-- Treat a detected spine as a book-information record only when it has a title.
-- This database boundary covers browser, MCP, and future Stage 1 producers.
alter function private.import_manual_genai_books(uuid, uuid, jsonb)
  rename to import_manual_genai_books_unfiltered;

revoke all on function private.import_manual_genai_books_unfiltered(uuid, uuid, jsonb)
  from public, anon, authenticated;

create function private.import_manual_genai_books(
  target_collection_id uuid,
  target_import_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_count integer;
  filtered_books jsonb;
begin
  if jsonb_typeof(payload -> 'books') is distinct from 'array' then
    raise exception 'books must be an array.';
  end if;

  source_count := jsonb_array_length(payload -> 'books');
  if source_count < 1 or source_count > 100 then
    raise exception 'books must contain between 1 and 100 items.';
  end if;

  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
    into filtered_books
  from jsonb_array_elements(payload -> 'books') with ordinality as source(item, ordinality)
  where jsonb_typeof(item) = 'object'
    and nullif(btrim(item ->> 'title'), '') is not null;

  if jsonb_array_length(filtered_books) = 0 then
    raise exception 'At least one book with a title is required.';
  end if;

  return private.import_manual_genai_books_unfiltered(
    target_collection_id,
    target_import_id,
    jsonb_set(payload, '{books}', filtered_books)
  );
end;
$$;

revoke all on function private.import_manual_genai_books(uuid, uuid, jsonb)
  from public, anon, authenticated;
