-- Bootstrap org membership for a Supabase Auth test user
-- Run this in Supabase Dashboard -> SQL Editor (it runs as an admin role).
--
-- Purpose:
-- - Ensure a given auth user is an 'owner' of an organization
-- - This makes RLS policies pass for your app + integration tests
--
-- Steps:
-- 1) Create a user in Supabase -> Authentication -> Users (email/password)
-- 2) Replace the EMAIL below
-- 3) Run this script
--
-- NOTE:
-- - Do NOT put passwords here.
-- - This assumes you've already applied supabase/migrations/20260204_init.sql
--
-- Quick check (run anytime) to see existing users:
--   select email, id, created_at from auth.users order by created_at desc limit 20;

begin;

do $$
declare
  v_email text := 'test@example.com';
  -- Organization name as used by the app. You can use an email if you want.
  v_org_name text := 'test@example.com';
  v_user_id uuid;
  v_org_id uuid;
begin
  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(v_email)
  limit 1;

  if v_user_id is null then
    raise exception 'No auth user found for email: % (create it in Auth -> Users first)', v_email;
  end if;

  -- Find or create org
  select o.id into v_org_id
  from public.organizations o
  where o.name = v_org_name
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name, created_by)
    values (v_org_name, v_user_id)
    returning id into v_org_id;
  end if;

  -- Ensure membership as owner (upsert)
  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, v_user_id, 'owner')
  on conflict (org_id, user_id)
  do update set role = excluded.role;
end $$;

commit;
