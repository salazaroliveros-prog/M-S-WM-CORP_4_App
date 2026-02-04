-- APU + Material Prices Catalog (web-import friendly)
-- Safe approach: import from an explicit URL (CSV/JSON) you control or an official API.

-- -----------------------------------------------------------------------------
-- Material catalog items
-- -----------------------------------------------------------------------------

create table if not exists public.material_catalog_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  name text not null,
  name_norm text not null,
  unit text not null default '',

  category text,
  external_ref text,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint material_catalog_items_id_org_unique unique (id, org_id),
  constraint material_catalog_items_org_name_unit_unique unique (org_id, name_norm, unit)
);

create index if not exists material_catalog_items_org_name_idx on public.material_catalog_items(org_id, lower(name));
create index if not exists material_catalog_items_org_norm_idx on public.material_catalog_items(org_id, name_norm);

create trigger material_catalog_items_set_updated_at
before update on public.material_catalog_items
for each row
execute function app.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Material price quotes (versioned)
-- -----------------------------------------------------------------------------

create table if not exists public.material_price_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  material_id uuid not null,

  vendor text not null default '',
  currency text not null default 'USD',
  unit_price numeric(14,2) not null check (unit_price >= 0),
  price_date date not null default (now() at time zone 'utc')::date,

  source_type text not null default 'web',
  source_url text,
  notes text,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint material_price_quotes_id_org_unique unique (id, org_id),
  constraint material_price_quotes_material_fk foreign key (material_id, org_id)
    references public.material_catalog_items(id, org_id) on delete cascade,
  constraint material_price_quotes_unique unique (material_id, org_id, vendor, price_date)
);

create index if not exists material_price_quotes_material_date_idx on public.material_price_quotes(org_id, material_id, price_date desc);

create trigger material_price_quotes_set_updated_at
before update on public.material_price_quotes
for each row
execute function app.tg_set_updated_at();

-- Latest price per material (by date then updated_at)
create or replace view public.v_material_latest_prices as
select distinct on (q.org_id, q.material_id)
  q.org_id,
  q.material_id,
  q.unit_price,
  q.currency,
  q.vendor,
  q.price_date,
  q.source_url,
  q.updated_at
from public.material_price_quotes q
order by q.org_id, q.material_id, q.price_date desc, q.updated_at desc;

-- -----------------------------------------------------------------------------
-- APU templates (unit costs + materials + meta for yields/rendimientos)
-- -----------------------------------------------------------------------------

create table if not exists public.apu_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  typology public.typology not null,
  name text not null,
  name_norm text not null,
  unit text not null default 'Glb',

  labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  equipment_cost numeric(14,2) not null default 0 check (equipment_cost >= 0),

  -- Array of materials: [{ name, unit, quantityPerUnit, unitPrice? }]
  materials jsonb not null default '[]'::jsonb,

  -- Meta to store productivity/yields, crew definitions, assumptions, etc.
  meta jsonb not null default '{}'::jsonb,

  currency text,
  source text,
  source_url text,
  effective_date date,
  last_refreshed_at timestamptz,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint apu_templates_id_org_unique unique (id, org_id),
  constraint apu_templates_org_typology_name_unique unique (org_id, typology, name_norm)
);

create index if not exists apu_templates_org_typology_idx on public.apu_templates(org_id, typology);
create index if not exists apu_templates_org_norm_idx on public.apu_templates(org_id, typology, name_norm);
create index if not exists apu_templates_org_name_idx on public.apu_templates(org_id, typology, lower(name));

create trigger apu_templates_set_updated_at
before update on public.apu_templates
for each row
execute function app.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.material_catalog_items enable row level security;
alter table public.material_price_quotes enable row level security;
alter table public.apu_templates enable row level security;

-- material_catalog_items
create policy material_catalog_items_select
on public.material_catalog_items
for select
using (app.is_org_member(org_id));

create policy material_catalog_items_write
on public.material_catalog_items
for all
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

-- material_price_quotes
create policy material_price_quotes_select
on public.material_price_quotes
for select
using (app.is_org_member(org_id));

create policy material_price_quotes_write
on public.material_price_quotes
for all
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

-- apu_templates
create policy apu_templates_select
on public.apu_templates
for select
using (app.is_org_member(org_id));

create policy apu_templates_write
on public.apu_templates
for all
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));
