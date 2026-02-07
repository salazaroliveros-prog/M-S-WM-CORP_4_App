-- Ensure Supabase Realtime publication includes all core public tables.
--
-- Supabase manages the `supabase_realtime` publication; this migration is idempotent
-- and only adds tables that exist and are missing from the publication.

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

    -- Compras
    'public.suppliers',
    'public.requisitions',
    'public.requisition_items',

    -- RRHH
    'public.employees',
    'public.employee_contracts',
    'public.org_pay_rates',
    'public.employee_rate_overrides',

    -- Cotizador / Intake
    'public.service_quotes',

    -- Seguimiento
    'public.project_progress',
    'public.project_progress_lines',

    -- Asistencia
    'public.attendance',
    'public.employee_attendance_tokens',

    -- Other tables used by the app (best-effort)
    'public.project_phases',
    'public.payroll_periods',
    'public.payroll_entries',
    'public.quotes',
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
    end if;
  end loop;
end $$;

commit;
