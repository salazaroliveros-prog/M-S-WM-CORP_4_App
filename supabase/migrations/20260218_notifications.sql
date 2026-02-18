-- Migration: create notifications table and add to realtime publication
begin;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  type text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_org_id_idx on public.notifications(org_id);
create index if not exists notifications_employee_id_idx on public.notifications(employee_id);
create index if not exists notifications_type_idx on public.notifications(type);
create index if not exists notifications_read_idx on public.notifications(read);

-- Add to supabase_realtime publication if not already present
-- (idempotent, safe to run multiple times)
do $$
declare
  pub_name text := 'supabase_realtime';
begin
  if exists (select 1 from pg_publication where pubname = pub_name) then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = pub_name and schemaname = 'public' and tablename = 'notifications'
    ) then
      execute format('alter publication %I add table public.notifications', pub_name);
    end if;
  end if;
end$$;

commit;
