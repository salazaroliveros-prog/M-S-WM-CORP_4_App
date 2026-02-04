-- Add employee contract tracking (RRHH contracts)
-- Date: 2026-02-04

begin;

create table if not exists public.employee_contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  request_id uuid not null,
  status text not null default 'sent' check (status in ('sent', 'received', 'void')),

  employee_id uuid,
  project_id uuid,

  employee_name text not null,
  employee_phone text,
  role text not null,
  daily_rate numeric(14,2) not null default 0 check (daily_rate >= 0),

  seed jsonb not null,
  response jsonb,

  requested_at timestamptz not null default now(),
  responded_at timestamptz,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint employee_contracts_id_org_unique unique (id, org_id),
  constraint employee_contracts_request_unique unique (org_id, request_id),

  constraint employee_contracts_employee_fk foreign key (employee_id, org_id)
    references public.employees(id, org_id) on delete set null,
  constraint employee_contracts_project_fk foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete set null
);

create index if not exists employee_contracts_org_requested_idx on public.employee_contracts(org_id, requested_at);
create index if not exists employee_contracts_org_employee_idx on public.employee_contracts(org_id, employee_id);
create index if not exists employee_contracts_org_project_idx on public.employee_contracts(org_id, project_id);

create trigger employee_contracts_set_updated_at
before update on public.employee_contracts
for each row
execute function app.tg_set_updated_at();

alter table public.employee_contracts enable row level security;

create policy employee_contracts_crud
on public.employee_contracts
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

commit;
