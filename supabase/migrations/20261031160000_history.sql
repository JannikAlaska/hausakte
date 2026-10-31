-- Version history for hausakte_docs: every replaced or deleted version is kept, so a document that was
-- overwritten by another device (or by mistake) can be restored. Writes only through the trigger.
-- Retention: everything from the last day, older versions one per hour, nothing older than 60 days.
create table public.hausakte_docs_history (
  hid bigint generated always as identity primary key,
  collection text not null,
  id text not null,
  data jsonb,
  saved_at timestamptz,          -- when this version had been saved
  saved_by uuid,
  replaced_at timestamptz not null default now(),
  replaced_by uuid default auth.uid(),
  op text not null               -- 'update' | 'delete'
);
create index hausakte_docs_history_doc on public.hausakte_docs_history (collection, id, hid desc);
alter table public.hausakte_docs_history enable row level security;
create policy "members read history" on public.hausakte_docs_history for select to authenticated using ((select public.hausakte_is_member()));
revoke insert, update, delete on public.hausakte_docs_history from anon, authenticated;

create function public.hausakte_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.data is not distinct from new.data then
    return null;
  end if;
  insert into public.hausakte_docs_history (collection, id, data, saved_at, saved_by, op)
  values (old.collection, old.id, old.data, old.updated_at, old.updated_by, lower(tg_op));
  delete from public.hausakte_docs_history h
  where h.collection = old.collection and h.id = old.id
    and (h.replaced_at < now() - interval '60 days'
      or (h.replaced_at < now() - interval '1 day'
        and exists (select 1 from public.hausakte_docs_history n
                    where n.collection = h.collection and n.id = h.id and n.hid > h.hid
                      and date_trunc('hour', n.replaced_at) = date_trunc('hour', h.replaced_at))));
  return null;
end;
$$;
revoke execute on function public.hausakte_archive() from public, anon, authenticated;
create trigger hausakte_docs_archive after update or delete on public.hausakte_docs for each row execute function public.hausakte_archive();

-- overview of the stored versions of one document (counts instead of the full content)
create function public.hausakte_history(p_collection text, p_id text)
returns table (hid bigint, saved_at timestamptz, replaced_at timestamptz, op text, walls int, rooms int, furniture int, lines int, points int, chars int)
language sql
stable
security invoker
set search_path = ''
as $$
  select h.hid, h.saved_at, h.replaced_at, h.op,
    (case when jsonb_typeof(h.data->'walls') = 'array' then jsonb_array_length(h.data->'walls') else 0 end),
    (case when jsonb_typeof(h.data->'rooms') = 'array' then jsonb_array_length(h.data->'rooms') else 0 end),
    (case when jsonb_typeof(h.data->'furniture') = 'array' then jsonb_array_length(h.data->'furniture') else 0 end),
    (case when jsonb_typeof(h.data->'lines') = 'array' then jsonb_array_length(h.data->'lines') else 0 end),
    (case when jsonb_typeof(h.data->'points') = 'array' then jsonb_array_length(h.data->'points') else 0 end),
    length(h.data::text)
  from public.hausakte_docs_history h
  where h.collection = p_collection and h.id = p_id
  order by h.hid desc
  limit 300;
$$;
revoke execute on function public.hausakte_history(text, text) from public, anon;
grant execute on function public.hausakte_history(text, text) to authenticated;
