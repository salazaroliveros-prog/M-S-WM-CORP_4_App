-- Adds persistence (CRUD) support for module settings (RRHH), suppliers templates (Compras)
-- and service quote history (Cotizador).

-- -----------------------------------------------------------------------------
-- Suppliers: templates
-- -----------------------------------------------------------------------------

alter table if exists public.suppliers
  add column if not exists default_note_template text;

alter table if exists public.suppliers
  add column if not exists terms_template text;

-- -----------------------------------------------------------------------------
-- RRHH: org pay rates + employee overrides
-- -----------------------------------------------------------------------------

create table if not exists public.org_pay_rates (
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,
  daily_rate numeric not null,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (org_id, role)
);

drop trigger if exists org_pay_rates_set_updated_at on public.org_pay_rates;
create trigger org_pay_rates_set_updated_at
before update on public.org_pay_rates
for each row
execute function app.tg_set_updated_at();

create table if not exists public.employee_rate_overrides (
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  daily_rate numeric not null,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (org_id, employee_id),
  constraint employee_rate_overrides_employee_fk foreign key (employee_id, org_id)
    references public.employees(id, org_id) on delete cascade
);

drop trigger if exists employee_rate_overrides_set_updated_at on public.employee_rate_overrides;
create trigger employee_rate_overrides_set_updated_at
before update on public.employee_rate_overrides
for each row
execute function app.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Cotizador: quote history
-- -----------------------------------------------------------------------------

create table if not exists public.service_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  client text not null,
  phone text,
  address text,

  service_name text not null,
  quantity numeric not null,
  unit text,
  unit_price numeric,
  total numeric,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_quotes_org_created_idx on public.service_quotes(org_id, created_at desc);
create index if not exists service_quotes_org_phone_idx on public.service_quotes(org_id, phone);

drop trigger if exists service_quotes_set_updated_at on public.service_quotes;
create trigger service_quotes_set_updated_at
before update on public.service_quotes
for each row
execute function app.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.org_pay_rates enable row level security;
alter table public.employee_rate_overrides enable row level security;
alter table public.service_quotes enable row level security;

drop policy if exists org_pay_rates_crud on public.org_pay_rates;
create policy org_pay_rates_crud
on public.org_pay_rates
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

drop policy if exists employee_rate_overrides_crud on public.employee_rate_overrides;
create policy employee_rate_overrides_crud
on public.employee_rate_overrides
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

drop policy if exists service_quotes_crud on public.service_quotes;
create policy service_quotes_crud
on public.service_quotes
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));
