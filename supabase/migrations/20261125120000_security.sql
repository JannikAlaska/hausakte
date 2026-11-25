-- Security hardening (2026-11-25)

-- 1. The membership check lives in a schema the API does not expose, so it cannot be called as
--    /rest/v1/rpc/hausakte_is_member; the row level security policies use it from there.
create schema if not exists hausakte_private;
revoke all on schema hausakte_private from public;
grant usage on schema hausakte_private to authenticated, service_role;

create function hausakte_private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.hausakte_members m where m.user_id = (select auth.uid()));
$$;
revoke execute on function hausakte_private.is_member() from public, anon;
grant execute on function hausakte_private.is_member() to authenticated;

alter policy "members read docs" on public.hausakte_docs using ((select hausakte_private.is_member()));
alter policy "members add docs" on public.hausakte_docs with check ((select hausakte_private.is_member()));
alter policy "members change docs" on public.hausakte_docs using ((select hausakte_private.is_member())) with check ((select hausakte_private.is_member()));
alter policy "members delete docs" on public.hausakte_docs using ((select hausakte_private.is_member()));
alter policy "members read history" on public.hausakte_docs_history using ((select hausakte_private.is_member()));
alter policy "members see members" on public.hausakte_members using ((select hausakte_private.is_member()));
alter policy "members see invites" on public.hausakte_invites using ((select hausakte_private.is_member()));
alter policy "members invite" on public.hausakte_invites with check ((select hausakte_private.is_member()) and role = 'editor');
alter policy "members renew invites" on public.hausakte_invites using ((select hausakte_private.is_member())) with check ((select hausakte_private.is_member()) and role = 'editor');
alter policy "members revoke invites" on public.hausakte_invites using ((select hausakte_private.is_member()));
alter policy "hausakte members read files" on storage.objects using (bucket_id = 'hausakte' and (select hausakte_private.is_member()));
alter policy "hausakte members add files" on storage.objects with check (bucket_id = 'hausakte' and (select hausakte_private.is_member()));
alter policy "hausakte members change files" on storage.objects using (bucket_id = 'hausakte' and (select hausakte_private.is_member())) with check (bucket_id = 'hausakte' and (select hausakte_private.is_member()));
alter policy "hausakte members delete files" on storage.objects using (bucket_id = 'hausakte' and (select hausakte_private.is_member()));

drop function public.hausakte_is_member();

-- 2. A new member's role only ever comes from the invite (hausakte_check_invite writes it); anything
--    else a sign-up might send along becomes "editor".
create or replace function public.hausakte_add_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r text := new.raw_user_meta_data ->> 'hausakte_role';
begin
  insert into public.hausakte_members (user_id, email, role)
  values (new.id, lower(new.email), case when r in ('owner', 'editor') then r else 'editor' end);
  delete from public.hausakte_invites where email = lower(new.email);
  return new;
end;
$$;

-- 3. Files: no SVG (it can carry scripts), at most 25 MB.
update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'text/plain', 'text/csv', 'text/markdown', 'application/json'],
    file_size_limit = 26214400
where id = 'hausakte';

-- 4. Rate limits for the edge functions (AI requests per member, sign-up attempts per address).
--    Only the service role (the edge functions) can take from it.
create table hausakte_private.rate_events (
  key text not null,
  at timestamptz not null default now()
);
alter table hausakte_private.rate_events enable row level security;
create index rate_events_key_at on hausakte_private.rate_events (key, at);
create index rate_events_at on hausakte_private.rate_events (at);

-- true and counted when the key is below every limit (p_max[i] events within p_seconds[i])
create function public.hausakte_rate_take(p_key text, p_seconds integer[], p_max integer[])
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  i integer;
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_key));
  delete from hausakte_private.rate_events where at < now() - interval '2 days';
  for i in 1 .. coalesce(array_length(p_seconds, 1), 0) loop
    select count(*) into n from hausakte_private.rate_events e
      where e.key = p_key and e.at > now() - make_interval(secs => p_seconds[i]);
    if n >= p_max[i] then
      return false;
    end if;
  end loop;
  insert into hausakte_private.rate_events (key) values (p_key);
  return true;
end;
$$;
revoke execute on function public.hausakte_rate_take(text, integer[], integer[]) from public, anon, authenticated;
grant execute on function public.hausakte_rate_take(text, integer[], integer[]) to service_role;
