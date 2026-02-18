-- Hard reset of all RLS policies on org_members to remove any recursive policies.
-- Date: 2026-02-18

begin;

alter table if exists public.org_members enable row level security;

-- Drop ALL existing policies on org_members, regardless of their names
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT quote_ident(polname) AS name
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'org_members'
  LOOP
    EXECUTE 'drop policy ' || pol.name || ' on public.org_members';
  END LOOP;
END$$;

-- Re-create minimal, non-recursive policies
create policy org_members_select
on public.org_members
for select
to anon, authenticated
using (
  user_id = (select auth.uid())
);

create policy org_members_insert
on public.org_members
for insert
to anon, authenticated
with check (
  user_id = (select auth.uid())
);

commit;
