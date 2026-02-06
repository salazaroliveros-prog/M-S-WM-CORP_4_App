-- Audit logs (enterprise-grade traceability)
-- Date: 2026-02-06
--
-- Goals:
-- - Record INSERT/UPDATE/DELETE events for key org-scoped tables
-- - Allow admins to review changes (select)
-- - Keep inserts automatic via triggers, without changing app logic

begin;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid null,

  actor_user_id uuid not null default auth.uid(),
  action text not null,
  table_name text not null,
  record_id uuid null,

  old_snapshot jsonb null,
  new_snapshot jsonb null,

  created_at timestamptz not null default now()
);

create index if not exists audit_logs_org_created_idx on public.audit_logs(org_id, created_at desc);
create index if not exists audit_logs_org_table_created_idx on public.audit_logs(org_id, table_name, created_at desc);
create index if not exists audit_logs_org_project_created_idx on public.audit_logs(org_id, project_id, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_insert on public.audit_logs;
drop policy if exists audit_logs_select_admin on public.audit_logs;

-- Members can insert their own audit rows (via triggers)
create policy audit_logs_insert
on public.audit_logs
for insert
to authenticated
with check (
  app.is_org_member(org_id)
  and actor_user_id = auth.uid()
);

-- Admins can read audit logs for their org
create policy audit_logs_select_admin
on public.audit_logs
for select
to authenticated
using (
  app.is_org_admin(org_id)
);

create or replace function app.tg_audit_log()
returns trigger
language plpgsql
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_org_id uuid;
  v_project_id uuid;
  v_record_id uuid;
begin
  if (tg_op = 'INSERT') then
    v_old := null;
    v_new := to_jsonb(new);
  elsif (tg_op = 'UPDATE') then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  elsif (tg_op = 'DELETE') then
    v_old := to_jsonb(old);
    v_new := null;
  else
    return null;
  end if;

  v_org_id := coalesce((v_new->>'org_id')::uuid, (v_old->>'org_id')::uuid);
  v_project_id := coalesce((v_new->>'project_id')::uuid, (v_old->>'project_id')::uuid);
  v_record_id := coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid);

  insert into public.audit_logs (
    org_id,
    project_id,
    actor_user_id,
    action,
    table_name,
    record_id,
    old_snapshot,
    new_snapshot
  )
  values (
    v_org_id,
    v_project_id,
    auth.uid(),
    tg_op,
    tg_table_name,
    v_record_id,
    v_old,
    v_new
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

-- Attach triggers to key tables (org-scoped)
-- NOTE: Keep the list focused; add more tables as needed.

drop trigger if exists audit_projects on public.projects;
create trigger audit_projects
after insert or update or delete on public.projects
for each row execute function app.tg_audit_log();

drop trigger if exists audit_transactions on public.transactions;
create trigger audit_transactions
after insert or update or delete on public.transactions
for each row execute function app.tg_audit_log();

drop trigger if exists audit_budgets on public.budgets;
create trigger audit_budgets
after insert or update or delete on public.budgets
for each row execute function app.tg_audit_log();

drop trigger if exists audit_budget_lines on public.budget_lines;
create trigger audit_budget_lines
after insert or update or delete on public.budget_lines
for each row execute function app.tg_audit_log();

drop trigger if exists audit_budget_line_materials on public.budget_line_materials;
create trigger audit_budget_line_materials
after insert or update or delete on public.budget_line_materials
for each row execute function app.tg_audit_log();

drop trigger if exists audit_requisitions on public.requisitions;
create trigger audit_requisitions
after insert or update or delete on public.requisitions
for each row execute function app.tg_audit_log();

drop trigger if exists audit_requisition_items on public.requisition_items;
create trigger audit_requisition_items
after insert or update or delete on public.requisition_items
for each row execute function app.tg_audit_log();

drop trigger if exists audit_employees on public.employees;
create trigger audit_employees
after insert or update or delete on public.employees
for each row execute function app.tg_audit_log();

drop trigger if exists audit_employee_contracts on public.employee_contracts;
create trigger audit_employee_contracts
after insert or update or delete on public.employee_contracts
for each row execute function app.tg_audit_log();

drop trigger if exists audit_attendance on public.attendance;
create trigger audit_attendance
after insert or update or delete on public.attendance
for each row execute function app.tg_audit_log();

drop trigger if exists audit_project_progress on public.project_progress;
create trigger audit_project_progress
after insert or update or delete on public.project_progress
for each row execute function app.tg_audit_log();

drop trigger if exists audit_project_progress_lines on public.project_progress_lines;
create trigger audit_project_progress_lines
after insert or update or delete on public.project_progress_lines
for each row execute function app.tg_audit_log();

commit;
