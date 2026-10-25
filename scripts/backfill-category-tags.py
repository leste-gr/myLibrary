"""Apply an explicitly reviewed metadata/category plan; dry-run by default.
No model/provider calls or inference run here. The plan contains a metadata snapshot,
old values, proposed tags and the review reason for every targeted physical copy.
"""
import argparse
import json
import os
from pathlib import Path
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project', required=True)
parser.add_argument('--plan', type=Path, required=True)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
books = json.loads(args.plan.read_text())['books']
assert books and len({b['id'] for b in books}) == len(books), 'Plan must have unique copy IDs.'
for book in books:
    uuid.UUID(book['id'])
    assert 1 <= len(book['categories']) <= 8
    assert all(isinstance(t, str) and 1 <= len(t.strip()) <= 80 for t in book['categories'])
    assert isinstance(book['reason'], str) and book['reason']
    assert isinstance(book['oldCategories'], list)


def query(sql):
    request = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{args.project}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'], 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


# Single-quoted SQL literals are escaped as SQL; no shell interpolation is used.
literal = "'" + json.dumps(books, ensure_ascii=False).replace("'", "''") + "'::jsonb"
plan_query = f'''select * from jsonb_to_recordset({literal}) as p(
 id uuid,title text,author text,series text,"oldCategory" text,"oldCategories" text[],
 categories text[],reason text,confidence text)'''
conflicts = '''c.id is null or c.category is distinct from p."oldCategory"
 or c.categories is distinct from p."oldCategories" or w.title is distinct from p.title
 or w.author is distinct from p.author or w.series is distinct from p.series'''
summary = query(f'''with plan as ({plan_query}) select
 (select count(*) from public.copies) as total_books,count(*) as planned,
 count(*) filter(where {conflicts}) as conflicts
 from plan p left join public.copies c on c.id=p.id left join public.works w on w.id=c.work_id''')[0]
print(json.dumps({'mode': 'apply' if args.apply else 'dry-run', **summary}))
assert summary['conflicts'] == 0, 'Metadata or categories changed since review. Refresh the plan.'
assert summary['total_books'] == len(books), 'The all-collection inventory changed. Review newly added/removed books.'
if not args.apply:
    raise SystemExit(0)

backup_path = args.plan.with_suffix('.before.json')
backup = query('select id,category,categories,updated_at from public.copies order by id')
# Never replace an earlier rollback snapshot, including on a failed/repeated run.
with os.fdopen(os.open(backup_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as output:
    json.dump(backup, output, ensure_ascii=False, indent=2)
sql = f'''begin isolation level serializable;
create temporary table category_backfill_plan on commit drop as {plan_query};
create temporary table category_backfill_before on commit drop as
 select c.id,to_jsonb(c)-'category'-'categories'-'updated_at' as unchanged
 from public.copies c join category_backfill_plan p on p.id=c.id;
do $backfill$
declare changed integer;
begin
 if (select count(*) from public.copies)<>{len(books)} or exists(
  select 1 from category_backfill_plan p left join public.copies c on c.id=p.id
  left join public.works w on w.id=c.work_id where {conflicts}
 ) then raise exception 'Category plan conflicts with the current inventory.'; end if;
 insert into public.audit_events(copy_id,action,previous_value,new_value)
 select c.id,'category_tags_backfill',jsonb_build_object('category',c.category,'categories',c.categories),
  jsonb_build_object('categories',p.categories,'source','metadata-review','reason',p.reason,'confidence',p.confidence)
 from public.copies c join category_backfill_plan p on p.id=c.id;
 update public.copies c set categories=p.categories,updated_at=now()
 from category_backfill_plan p where c.id=p.id;
 get diagnostics changed=row_count;
 if changed<>{len(books)} then raise exception 'Unexpected category update count.'; end if;
 if exists(select 1 from public.copies c join category_backfill_plan p on p.id=c.id where c.categories<>p.categories)
  then raise exception 'Stored tags differ from the reviewed plan.'; end if;
 if exists(select 1 from public.copies c join category_backfill_before b on b.id=c.id
  where to_jsonb(c)-'category'-'categories'-'updated_at' is distinct from b.unchanged)
  then raise exception 'Non-category book fields changed; rolling back.'; end if;
end;
$backfill$;
commit;
select count(*) as books,count(*) filter(where cardinality(categories)>0) as tagged,
 count(*) filter(where categories=array['Uncategorized']) as unresolved from public.copies;
'''
print(json.dumps({'result': query(sql), 'rollback_snapshot': str(backup_path)}))
