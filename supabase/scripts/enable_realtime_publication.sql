-- Enable Supabase Realtime (WAL) for selected public tables.
--
-- Run this in Supabase SQL Editor if you want realtime subscriptions to emit
-- `postgres_changes` events from supabase-js.
--
-- Note: Supabase manages the `supabase_realtime` publication. This script only
-- adds tables to that publication if they are missing.

begin;

do $$
declare
  pub_name text := 'supabase_realtime';
  fqtn text;
  schema_name text;
  table_name text;
  tables text[] := array[
    -- Core
    'public.projects',
    'public.transactions',

    -- Presupuestos
    'public.budgets',
    'public.budget_lines',
    'public.budget_line_materials',

    -- Seguimiento
    'public.project_progress',
    'public.project_progress_lines',
    'public.project_phases',

    -- Compras
    'public.requisitions',
    'public.requisition_items',
    'public.suppliers',

    -- RRHH
    'public.employees',
    'public.employee_contracts',
    'public.payroll_periods',
    'public.payroll_entries',

    -- Asistencia
    'public.attendance',
    'public.employee_attendance_tokens',

    -- Cotizador
    'public.quotes',

    -- Catálogo APU + precios (si aplicaste 20260204_catalog_apu_prices.sql)
    'public.material_catalog_items',
    'public.material_price_quotes',
    'public.apu_templates'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = pub_name) then
    raise notice 'Publication % not found. Enable Realtime in Supabase Dashboard first.', pub_name;
    return;
  end if;

  foreach fqtn in array tables loop
    schema_name := split_part(fqtn, '.', 1);
    table_name := split_part(fqtn, '.', 2);

    if to_regclass(fqtn) is null then
      raise notice 'Table not found, skipping: %', fqtn;
      continue;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = pub_name
        and schemaname = schema_name
        and tablename = table_name
    ) then
      execute format('alter publication %I add table %s', pub_name, fqtn);
      raise notice 'Added % to publication %', fqtn, pub_name;
    else
      raise notice 'Already present: %', fqtn;
    end if;
  end loop;
end $$;

commit;
