-- Supabase (Postgres) schema for M&S-WM-CORP-4_App
-- Generated from UI logic in components/*
-- Date: 2026-02-04

begin;

-- Extensions
create extension if not exists pgcrypto;

-- Helper schema for functions/triggers
create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

create or replace function app.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Membership helpers used in RLS policies.
-- SECURITY DEFINER ensures org membership checks work even when org_members has RLS.
-- NOTE: is_org_member/is_org_admin are defined after org_members table exists.

-- -----------------------------------------------------------------------------
-- Enums (match UI semantics)
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.project_status as enum ('standby', 'active', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.typology as enum ('RESIDENCIAL', 'COMERCIAL', 'INDUSTRIAL', 'CIVIL', 'PUBLICA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.transaction_type as enum ('INGRESO', 'GASTO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.requisition_status as enum ('draft', 'sent', 'confirmed', 'received', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.employee_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payroll_status as enum ('draft', 'approved', 'paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.org_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Core multi-tenant security model
-- -----------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function app.tg_set_updated_at();

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_id_idx on public.org_members(user_id);

-- Membership helpers used in RLS policies.
-- SECURITY DEFINER ensures org membership checks work even when org_members has RLS.
create or replace function app.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function app.is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

-- Bootstrap: when an organization is created, automatically add the creator as owner.
create or replace function app.tg_organizations_add_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists organizations_add_owner on public.organizations;
create trigger organizations_add_owner
after insert on public.organizations
for each row
execute function app.tg_organizations_add_owner();

-- -----------------------------------------------------------------------------
-- Proyectos (components/Proyectos.tsx)
-- -----------------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  name text not null,
  client_name text not null,
  location text not null,
  lot text,
  block text,
  coordinates text,

  area_land numeric(12,2) not null check (area_land > 0),
  area_build numeric(12,2) not null check (area_build > 0),

  needs text not null default '',
  status public.project_status not null default 'standby',
  start_date date not null default (now() at time zone 'utc')::date,
  typology public.typology not null,
  project_manager text not null,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint projects_id_org_unique unique (id, org_id)
);

create index if not exists projects_org_id_idx on public.projects(org_id);
create index if not exists projects_org_status_idx on public.projects(org_id, status);
create index if not exists projects_org_name_idx on public.projects(org_id, lower(name));
create index if not exists projects_org_client_idx on public.projects(org_id, lower(client_name));

create trigger projects_set_updated_at
before update on public.projects
for each row
execute function app.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Transacciones (components/Inicio.tsx)
-- -----------------------------------------------------------------------------

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,

  type public.transaction_type not null,
  description text not null,
  amount numeric(14,2) not null check (amount >= 0),
  unit text not null default 'Quetzal',
  cost numeric(14,2) not null check (cost >= 0),
  category text not null,
  occurred_at timestamptz not null default now(),

  provider text,
  rent_end_date date,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint transactions_project_fk foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete cascade
);

create index if not exists transactions_project_date_idx on public.transactions(project_id, occurred_at desc);
create index if not exists transactions_org_project_idx on public.transactions(org_id, project_id);

create trigger transactions_set_updated_at
before update on public.transactions
for each row
execute function app.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Presupuestos (components/Presupuestos.tsx)
-- Model: 1 presupuesto por proyecto (editable), con renglones y materiales.
-- -----------------------------------------------------------------------------

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,

  typology public.typology not null,
  indirect_pct numeric(5,2) not null default 35 check (indirect_pct >= 0 and indirect_pct <= 100),
  notes text,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint budgets_one_per_project unique (project_id),
  constraint budgets_id_org_unique unique (id, org_id),
  constraint budgets_project_fk foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete cascade
);

create index if not exists budgets_org_project_idx on public.budgets(org_id, project_id);

create trigger budgets_set_updated_at
before update on public.budgets
for each row
execute function app.tg_set_updated_at();

create table if not exists public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  budget_id uuid not null,

  name text not null,
  unit text not null default 'Glb',
  quantity numeric(14,4) not null default 0 check (quantity >= 0),

  labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  equipment_cost numeric(14,2) not null default 0 check (equipment_cost >= 0),

  -- Cached total direct cost for the line ( (mat + labor + equipment) * quantity )
  direct_cost numeric(14,2) not null default 0 check (direct_cost >= 0),

  sort_order int not null default 0,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint budget_lines_id_org_unique unique (id, org_id)
  ,constraint budget_lines_budget_fk foreign key (budget_id, org_id)
    references public.budgets(id, org_id) on delete cascade
);

create index if not exists budget_lines_budget_id_idx on public.budget_lines(budget_id, sort_order);
create index if not exists budget_lines_org_budget_idx on public.budget_lines(org_id, budget_id);

create table if not exists public.budget_line_materials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  budget_line_id uuid not null,

  name text not null,
  unit text not null default '',
  quantity_per_unit numeric(14,6) not null default 0 check (quantity_per_unit >= 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint budget_line_materials_line_fk foreign key (budget_line_id, org_id)
    references public.budget_lines(id, org_id) on delete cascade
);

create index if not exists budget_line_materials_line_id_idx on public.budget_line_materials(budget_line_id);
create index if not exists budget_line_materials_org_line_idx on public.budget_line_materials(org_id, budget_line_id);

create trigger budget_lines_set_updated_at
before update on public.budget_lines
for each row
execute function app.tg_set_updated_at();

create trigger budget_line_materials_set_updated_at
before update on public.budget_line_materials
for each row
execute function app.tg_set_updated_at();

-- Recalculate budget_lines.direct_cost whenever budget_lines changes
create or replace function app.tg_budget_lines_recalc_direct_cost()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  mat_cost numeric(14,2);
  unit_direct numeric(14,2);
begin
  select coalesce(sum(m.quantity_per_unit * m.unit_price), 0)
    into mat_cost
    from public.budget_line_materials m
    where m.budget_line_id = new.id;

  unit_direct := mat_cost + new.labor_cost + new.equipment_cost;
  new.direct_cost := round(unit_direct * new.quantity, 2);

  return new;
end;
$$;

create trigger budget_lines_recalc_direct_cost
before insert or update of quantity, labor_cost, equipment_cost on public.budget_lines
for each row
execute function app.tg_budget_lines_recalc_direct_cost();

-- When materials change, bump the line (this invokes the BEFORE UPDATE recalculation)
create or replace function app.tg_budget_line_materials_bump_parent()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_line_id uuid;
begin
  v_line_id := coalesce(new.budget_line_id, old.budget_line_id);
  update public.budget_lines
     set updated_at = now(),
         quantity = quantity
   where id = v_line_id;

  return coalesce(new, old);
end;
$$;

create trigger budget_line_materials_bump_parent
after insert or update or delete on public.budget_line_materials
for each row
execute function app.tg_budget_line_materials_bump_parent();

-- Views to support Dashboard/Seguimiento reporting
create or replace view public.v_budget_totals as
select
  b.id as budget_id,
  b.org_id,
  b.project_id,
  b.typology,
  b.indirect_pct,
  coalesce(sum(bl.direct_cost), 0) as direct_cost_total,
  round(coalesce(sum(bl.direct_cost), 0) * (b.indirect_pct / 100.0), 2) as indirect_cost,
  round(coalesce(sum(bl.direct_cost), 0) + (coalesce(sum(bl.direct_cost), 0) * (b.indirect_pct / 100.0)), 2) as price_no_tax,
  round((coalesce(sum(bl.direct_cost), 0) + (coalesce(sum(bl.direct_cost), 0) * (b.indirect_pct / 100.0))) * 0.12, 2) as tax,
  round((coalesce(sum(bl.direct_cost), 0) + (coalesce(sum(bl.direct_cost), 0) * (b.indirect_pct / 100.0))) * 1.12, 2) as final_price
from public.budgets b
left join public.budget_lines bl on bl.budget_id = b.id
group by b.id;

-- -----------------------------------------------------------------------------
-- Compras / Requisiciones (components/Compras.tsx + Presupuestos Quick Buy)
-- -----------------------------------------------------------------------------

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  name text not null,
  phone text,
  whatsapp text,
  email text,
  notes text,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint suppliers_id_org_unique unique (id, org_id)
);

create index if not exists suppliers_org_name_idx on public.suppliers(org_id, lower(name));

create trigger suppliers_set_updated_at
before update on public.suppliers
for each row
execute function app.tg_set_updated_at();

create table if not exists public.requisitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,

  supplier_id uuid,
  source_budget_line_id uuid,

  status public.requisition_status not null default 'draft',
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  confirmed_at timestamptz,
  received_at timestamptz,

  notes text,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint requisitions_id_org_unique unique (id, org_id)
  ,constraint requisitions_project_fk foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete cascade
  ,constraint requisitions_supplier_fk foreign key (supplier_id, org_id)
    references public.suppliers(id, org_id) on delete set null
  ,constraint requisitions_source_budget_line_fk foreign key (source_budget_line_id, org_id)
    references public.budget_lines(id, org_id) on delete set null
);

create index if not exists requisitions_project_idx on public.requisitions(project_id, requested_at desc);
create index if not exists requisitions_org_project_idx on public.requisitions(org_id, project_id);

create trigger requisitions_set_updated_at
before update on public.requisitions
for each row
execute function app.tg_set_updated_at();

create table if not exists public.requisition_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  requisition_id uuid not null,

  name text not null,
  unit text not null default 'Unidad',
  quantity numeric(14,4) not null default 0 check (quantity >= 0),
  unit_price numeric(14,2) check (unit_price is null or unit_price >= 0),

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint requisition_items_requisition_fk foreign key (requisition_id, org_id)
    references public.requisitions(id, org_id) on delete cascade
);

create index if not exists requisition_items_req_idx on public.requisition_items(requisition_id);

create trigger requisition_items_set_updated_at
before update on public.requisition_items
for each row
execute function app.tg_set_updated_at();

create or replace view public.v_requisition_totals as
select
  r.id as requisition_id,
  r.org_id,
  r.project_id,
  r.supplier_id,
  s.name as supplier_name,
  r.status,
  r.requested_at,
  r.notes,
  coalesce(sum(ri.quantity * coalesce(ri.unit_price, 0)), 0) as total_amount
from public.requisitions r
left join public.requisition_items ri on ri.requisition_id = r.id
left join public.suppliers s on s.id = r.supplier_id
group by r.id, s.name;

-- -----------------------------------------------------------------------------
-- RRHH (components/RRHH.tsx)
-- -----------------------------------------------------------------------------

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,

  name text not null,
  dpi text,
  phone text,

  -- Kept as text to match UI labels (includes accents)
  position text not null check (position in ('Supervisor', 'Encargado', 'Maestro', 'Albañil', 'Ayudante', 'Peón')),
  daily_rate numeric(14,2) not null check (daily_rate >= 0),
  status public.employee_status not null default 'active',

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint employees_id_org_unique unique (id, org_id)
  ,constraint employees_project_fk foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete set null
);

create index if not exists employees_org_status_idx on public.employees(org_id, status);
create index if not exists employees_org_name_idx on public.employees(org_id, lower(name));

create trigger employees_set_updated_at
before update on public.employees
for each row
execute function app.tg_set_updated_at();

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  project_id uuid,

  work_date date not null,
  check_in timestamptz not null,
  check_out timestamptz,
  location_lat numeric(10,6) not null,
  location_lng numeric(10,6) not null,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attendance_one_per_day unique (employee_id, work_date),
  constraint attendance_employee_fk foreign key (employee_id, org_id)
    references public.employees(id, org_id) on delete cascade,
  constraint attendance_project_fk foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete set null
);

create index if not exists attendance_org_date_idx on public.attendance(org_id, work_date desc);

create trigger attendance_set_updated_at
before update on public.attendance
for each row
execute function app.tg_set_updated_at();

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  start_date date not null,
  end_date date not null,
  status public.payroll_status not null default 'draft',

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payroll_period_dates check (end_date >= start_date),
  constraint payroll_periods_id_org_unique unique (id, org_id)
);

create index if not exists payroll_periods_org_dates_idx on public.payroll_periods(org_id, start_date desc);

create trigger payroll_periods_set_updated_at
before update on public.payroll_periods
for each row
execute function app.tg_set_updated_at();

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  payroll_period_id uuid not null,
  employee_id uuid not null,

  days_worked int not null default 0 check (days_worked >= 0),
  extra_hours numeric(10,2) not null default 0 check (extra_hours >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  status public.payroll_status not null default 'draft',

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payroll_entries_unique unique (payroll_period_id, employee_id),
  constraint payroll_entries_period_fk foreign key (payroll_period_id, org_id)
    references public.payroll_periods(id, org_id) on delete cascade,
  constraint payroll_entries_employee_fk foreign key (employee_id, org_id)
    references public.employees(id, org_id) on delete restrict
);

create index if not exists payroll_entries_org_period_idx on public.payroll_entries(org_id, payroll_period_id);

create trigger payroll_entries_set_updated_at
before update on public.payroll_entries
for each row
execute function app.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Cotizador (components/Cotizador.tsx)
-- -----------------------------------------------------------------------------

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,

  client_name text not null,
  phone text,
  address text,

  service_name text not null,
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit text not null default 'unidad',
  quantity numeric(14,4) not null default 1 check (quantity > 0),

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint quotes_project_fk foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete set null
);

create index if not exists quotes_org_created_idx on public.quotes(org_id, created_at desc);

create trigger quotes_set_updated_at
before update on public.quotes
for each row
execute function app.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Seguimiento (components/Seguimiento.tsx)
-- Stores phase-level planned vs actual + physical progress per project.
-- -----------------------------------------------------------------------------

create table if not exists public.project_phases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,

  name text not null,
  planned_amount numeric(14,2) not null default 0 check (planned_amount >= 0),
  actual_amount numeric(14,2) not null default 0 check (actual_amount >= 0),
  physical_progress_pct numeric(5,2) not null default 0 check (physical_progress_pct >= 0 and physical_progress_pct <= 100),

  sort_order int not null default 0,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_phase_unique unique (project_id, name),
  constraint project_phases_project_fk foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete cascade
);

create index if not exists project_phases_project_idx on public.project_phases(project_id, sort_order);

create trigger project_phases_set_updated_at
before update on public.project_phases
for each row
execute function app.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Reporting views for Dashboard.tsx
-- -----------------------------------------------------------------------------

create or replace view public.v_project_cashflow_monthly as
select
  t.org_id,
  t.project_id,
  date_trunc('month', t.occurred_at) as month,
  sum(case when t.type = 'INGRESO' then t.amount else 0 end) as ingresos,
  sum(case when t.type = 'GASTO' then t.amount else 0 end) as gastos,
  sum(case when t.type = 'INGRESO' then t.amount else -t.amount end) as neto
from public.transactions t
group by t.org_id, t.project_id, date_trunc('month', t.occurred_at);

-- -----------------------------------------------------------------------------
-- Row Level Security (RLS)
-- -----------------------------------------------------------------------------

-- Enable RLS
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.projects enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.budget_lines enable row level security;
alter table public.budget_line_materials enable row level security;
alter table public.suppliers enable row level security;
alter table public.requisitions enable row level security;
alter table public.requisition_items enable row level security;
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.quotes enable row level security;
alter table public.project_phases enable row level security;

-- organizations
create policy organizations_select
on public.organizations
for select
to authenticated
using (app.is_org_member(id));

create policy organizations_insert
on public.organizations
for insert
to authenticated
with check (created_by = auth.uid());

create policy organizations_update
on public.organizations
for update
to authenticated
using (app.is_org_admin(id))
with check (app.is_org_admin(id));

create policy organizations_delete
on public.organizations
for delete
to authenticated
using (app.is_org_admin(id));

-- org_members
create policy org_members_select
on public.org_members
for select
to authenticated
using (app.is_org_member(org_id));

create policy org_members_insert
on public.org_members
for insert
to authenticated
with check (app.is_org_admin(org_id));

create policy org_members_update
on public.org_members
for update
to authenticated
using (app.is_org_admin(org_id))
with check (app.is_org_admin(org_id));

create policy org_members_delete
on public.org_members
for delete
to authenticated
using (app.is_org_admin(org_id));

-- Generic org-scoped CRUD (members can CRUD inside their org)
create policy projects_crud
on public.projects
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy transactions_crud
on public.transactions
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy budgets_crud
on public.budgets
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy budget_lines_crud
on public.budget_lines
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy budget_line_materials_crud
on public.budget_line_materials
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy suppliers_crud
on public.suppliers
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy requisitions_crud
on public.requisitions
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy requisition_items_crud
on public.requisition_items
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy employees_crud
on public.employees
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy attendance_crud
on public.attendance
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy payroll_periods_crud
on public.payroll_periods
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy payroll_entries_crud
on public.payroll_entries
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy quotes_crud
on public.quotes
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

create policy project_phases_crud
on public.project_phases
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

commit;
