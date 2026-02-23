begin;

-- Device push subscriptions for Web Push (PWA)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),

  endpoint text not null,
  p256dh text not null,
  auth text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint push_subscriptions_org_endpoint_unique unique (org_id, endpoint)
);

create index if not exists push_subscriptions_org_id_idx on public.push_subscriptions(org_id);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

drop trigger if exists push_subscriptions_set_updated_at on public.push_subscriptions;
create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row
execute function app.tg_set_updated_at();

alter table public.push_subscriptions enable row level security;

-- Members can manage only their own subscriptions, scoped to org membership.

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
on public.push_subscriptions
for select
using (app.is_org_member(org_id) and user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
on public.push_subscriptions
for insert
with check (app.is_org_member(org_id) and user_id = auth.uid());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
on public.push_subscriptions
for update
using (app.is_org_member(org_id) and user_id = auth.uid())
with check (app.is_org_member(org_id) and user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
on public.push_subscriptions
for delete
using (app.is_org_member(org_id) and user_id = auth.uid());

commit;
