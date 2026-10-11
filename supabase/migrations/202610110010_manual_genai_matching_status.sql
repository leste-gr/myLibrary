alter table public.manual_genai_imports
  add column matching_status text not null default 'pending',
  add column matched_count integer not null default 0,
  add column unresolved_count integer not null default 0,
  add column retryable_count integer not null default 0,
  add column matching_error text,
  add column matching_started_at timestamptz,
  add column matching_completed_at timestamptz,
  add constraint manual_genai_matching_status_check check (matching_status in ('pending', 'processing', 'completed', 'partial', 'failed')),
  add constraint manual_genai_matching_counts_check check (
    matched_count >= 0 and unresolved_count >= 0 and retryable_count >= 0
    and matched_count + unresolved_count + retryable_count <= book_count
  );

update public.manual_genai_imports as import
set matched_count = summary.matched_count,
    unresolved_count = summary.unresolved_count,
    retryable_count = summary.retryable_count,
    matching_status = case when summary.retryable_count > 0 then 'partial' else 'completed' end,
    matching_started_at = import.created_at,
    matching_completed_at = now()
from (
  select
    manual_genai_import_id,
    count(*) filter (where status = 'matched')::integer as matched_count,
    count(*) filter (where status = 'unresolved')::integer as unresolved_count,
    count(*) filter (where status = 'ready_for_matching')::integer as retryable_count
  from public.book_observations
  where manual_genai_import_id is not null
  group by manual_genai_import_id
) summary
where import.id = summary.manual_genai_import_id;

grant update(matching_status, matched_count, unresolved_count, retryable_count, matching_error, matching_started_at, matching_completed_at)
on public.manual_genai_imports to authenticated;

create policy "Owners update manual GenAI matching state"
on public.manual_genai_imports for update to authenticated
using (owner_id = auth.uid() and public.owns_collection(collection_id))
with check (owner_id = auth.uid() and public.owns_collection(collection_id));

create index manual_genai_imports_matching_status_idx
  on public.manual_genai_imports(collection_id, created_at desc)
  where matching_status in ('pending', 'processing', 'partial', 'failed');
