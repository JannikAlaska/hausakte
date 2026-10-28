-- Hausakte: one shared house file for a small group of people.
-- Everyone in hausakte_members can read and write everything; new accounts need an invite code.

create table public.hausakte_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now()
);

create table public.hausakte_invites (
  email text primary key check (email = lower(email)),
  code_hash text not null,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);

create table public.hausakte_docs (
  collection text not null check (collection in ('house', 'floors', 'components', 'projects', 'readings', 'documents', 'underlays')),
  id text not null check (length(id) between 1 and 120),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (collection, id)
);

alter table public.hausakte_members enable row level security;
alter table public.hausakte_invites enable row level security;
alter table public.hausakte_docs enable row level security;

revoke all on table public.hausakte_members, public.hausakte_invites, public.hausakte_docs from anon;

create function public.hausakte_is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.hausakte_members m where m.user_id = (select auth.uid()));
$$;
revoke execute on function public.hausakte_is_member() from public, anon;
grant execute on function public.hausakte_is_member() to authenticated;

-- documents
create policy "members read docs" on public.hausakte_docs for select to authenticated using ((select public.hausakte_is_member()));
create policy "members add docs" on public.hausakte_docs for insert to authenticated with check ((select public.hausakte_is_member()));
create policy "members change docs" on public.hausakte_docs for update to authenticated using ((select public.hausakte_is_member())) with check ((select public.hausakte_is_member()));
create policy "members delete docs" on public.hausakte_docs for delete to authenticated using ((select public.hausakte_is_member()));

-- members (rows are created by the signup trigger only)
create policy "members see members" on public.hausakte_members for select to authenticated using ((select public.hausakte_is_member()));

-- invites
create policy "members see invites" on public.hausakte_invites for select to authenticated using ((select public.hausakte_is_member()));
create policy "members invite" on public.hausakte_invites for insert to authenticated with check ((select public.hausakte_is_member()) and role = 'editor');
create policy "members renew invites" on public.hausakte_invites for update to authenticated using ((select public.hausakte_is_member())) with check ((select public.hausakte_is_member()) and role = 'editor');
create policy "members revoke invites" on public.hausakte_invites for delete to authenticated using ((select public.hausakte_is_member()));

create function public.hausakte_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger hausakte_docs_touch before update on public.hausakte_docs for each row execute function public.hausakte_touch();

-- Accounts are only created for an e-mail address with a valid invite code
-- (passed as user metadata "invite", normalised to A-Z0-9).
create function public.hausakte_check_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.hausakte_invites;
begin
  select * into inv from public.hausakte_invites i where i.email = lower(new.email) and i.expires_at > now();
  if inv.email is null
     or inv.code_hash <> encode(sha256(convert_to(coalesce(new.raw_user_meta_data ->> 'invite', ''), 'UTF8')), 'hex') then
    raise exception 'HAUSAKTE_SIGNUP_NOT_ALLOWED';
  end if;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'invite' || jsonb_build_object('hausakte_role', inv.role);
  return new;
end;
$$;

create function public.hausakte_add_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.hausakte_members (user_id, email, role)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'hausakte_role', 'editor'));
  delete from public.hausakte_invites where email = lower(new.email);
  return new;
end;
$$;

revoke execute on function public.hausakte_check_invite() from public, anon, authenticated;
revoke execute on function public.hausakte_add_member() from public, anon, authenticated;
revoke execute on function public.hausakte_touch() from public, anon;

create trigger hausakte_check_invite before insert on auth.users for each row execute function public.hausakte_check_invite();
create trigger hausakte_add_member after insert on auth.users for each row execute function public.hausakte_add_member();

-- live updates between devices
alter publication supabase_realtime add table public.hausakte_docs;

-- files (private bucket, members only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hausakte', 'hausakte', false, 52428800,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm', 'text/plain', 'text/csv', 'text/markdown', 'application/json']
)
on conflict (id) do nothing;

create policy "hausakte members read files" on storage.objects for select to authenticated using (bucket_id = 'hausakte' and (select public.hausakte_is_member()));
create policy "hausakte members add files" on storage.objects for insert to authenticated with check (bucket_id = 'hausakte' and (select public.hausakte_is_member()));
create policy "hausakte members change files" on storage.objects for update to authenticated using (bucket_id = 'hausakte' and (select public.hausakte_is_member()));
create policy "hausakte members delete files" on storage.objects for delete to authenticated using (bucket_id = 'hausakte' and (select public.hausakte_is_member()));
