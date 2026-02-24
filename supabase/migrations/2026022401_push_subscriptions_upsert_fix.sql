begin;

-- Allow upsert to work even if an endpoint row was previously associated
-- with a different user in the same org (e.g. shared device / re-login).
-- We still enforce that the updated row becomes owned by the current user.

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_member
on public.push_subscriptions
for update
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id) and user_id = auth.uid());

commit;
