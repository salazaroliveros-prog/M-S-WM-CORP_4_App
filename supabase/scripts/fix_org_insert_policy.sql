-- Fix for: "new row violates row-level security policy for table organizations"
-- Root causes addressed:
-- 1) Anonymous sign-in users may have JWT role `anon` instead of `authenticated`.
-- 2) INSERT ... returning can fail SELECT RLS before org_members is visible.
-- 3) If the org_members owner trigger doesn't run (or is delayed), creator can self-bootstrap.

begin;

-- organizations: allow creator to read immediately (avoids INSERT/RETURNING race)
drop policy if exists organizations_select on public.organizations;
create policy organizations_select
on public.organizations
for select
to anon, authenticated
using (app.is_org_member(id) or created_by = auth.uid());

drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert
on public.organizations
for insert
to anon, authenticated
with check (created_by = auth.uid());

-- org_members: allow reading membership under anon/authenticated JWTs
drop policy if exists org_members_select on public.org_members;
create policy org_members_select
on public.org_members
for select
to anon, authenticated
using (app.is_org_member(org_id));

-- org_members: allow creator to insert their own membership if needed
drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert
on public.org_members
for insert
to anon, authenticated
with check (
	app.is_org_admin(org_id)
	or (
		user_id = auth.uid()
		and exists (
			select 1 from public.organizations o
			where o.id = org_id
				and o.created_by = auth.uid()
		)
	)
);

commit;
