-- Fix infinite recursion in RLS policy for org_members
-- Date: 2026-02-18
-- Simplify org_members policies so they no longer depend on organizations,
-- avoiding mutual recursion between organizations and org_members policies.

begin;

-- Ensure RLS is enabled (safe if already enabled)
alter table if exists public.org_members enable row level security;

-- Each user can see only their own membership rows.
drop policy if exists org_members_select on public.org_members;
create policy org_members_select
on public.org_members
for select
to anon, authenticated
using (
  user_id = (select auth.uid())
);

-- Each user can insert membership rows only for themselves.
drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert
on public.org_members
for insert
to anon, authenticated
with check (
  user_id = (select auth.uid())
);

commit;
