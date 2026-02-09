-- Purga de datos de prueba (SMOKE_TEST / VITEST) POR ORGANIZACIÓN
--
-- Uso:
-- 1) Supabase Dashboard → SQL Editor
-- 2) Reemplaza el UUID en v_org_id
-- 3) Ejecuta
--
-- Importante:
-- - Esto NO borra todas las organizaciones; solo borra filas de prueba dentro de una org.
-- - Está diseñado para limpiar sobras de pruebas e2e/diagnósticos.
-- - No toca `auth.users` (usuarios). Si necesitas borrar el usuario de prueba, hazlo en Auth → Users.

begin;

do $$
declare
  v_org_id uuid := 'REEMPLAZAR-POR-ORG-ID';
begin
  if v_org_id::text = 'REEMPLAZAR-POR-ORG-ID' then
    raise exception 'Reemplaza v_org_id por un UUID válido antes de ejecutar.';
  end if;

  -- 1) Identificar IDs de proyectos de prueba
  create temporary table tmp_test_projects (id uuid primary key) on commit drop;
  insert into tmp_test_projects(id)
  select p.id
  from public.projects p
  where p.org_id = v_org_id
    and (
      p.name ilike 'SMOKE_TEST%'
      or p.name ilike 'VITEST_%'
      or p.client_name ilike 'SMOKE_TEST%'
      or p.client_name = 'VITEST'
      or p.needs ilike '%SMOKE_TEST%'
    );

  -- 2) Identificar IDs de empleados de prueba
  create temporary table tmp_test_employees (id uuid primary key) on commit drop;
  insert into tmp_test_employees(id)
  select e.id
  from public.employees e
  where e.org_id = v_org_id
    and (
      e.name ilike 'SMOKE_TEST%'
      or e.name ilike 'VITEST_%'
      or e.phone ilike '%SMOKE%'
    );

  -- 3) Limpiar tablas que NO siempre caen por cascada de projects
  -- Requisiciones / proveedores
  delete from public.requisition_items ri
  using public.requisitions r
  where ri.org_id = v_org_id
    and r.id = ri.requisition_id
    and (
      r.project_id in (select id from tmp_test_projects)
      or r.notes ilike '%SMOKE_TEST%'
    );

  delete from public.requisitions r
  where r.org_id = v_org_id
    and (
      r.project_id in (select id from tmp_test_projects)
      or r.notes ilike '%SMOKE_TEST%'
    );

  delete from public.suppliers s
  where s.org_id = v_org_id
    and (
      s.name ilike 'SMOKE_TEST%'
      or s.name ilike 'VITEST_SUPP_%'
      or coalesce(s.notes,'') ilike '%SMOKE_TEST%'
    );

  -- RRHH contratos / tasas
  delete from public.employee_rate_overrides o
  where o.org_id = v_org_id
    and o.employee_id in (select id from tmp_test_employees);

  delete from public.org_pay_rates r
  where r.org_id = v_org_id
    and r.role ilike 'SMOKE_TEST_ROLE_%';

  delete from public.employee_contracts c
  where c.org_id = v_org_id
    and (
      c.employee_id in (select id from tmp_test_employees)
      or c.employee_name ilike 'SMOKE_TEST%'
      or c.employee_name ilike 'VITEST_%'
      or c.role ilike 'SMOKE_TEST%'
      or c.role ilike 'VITEST%'
    );

  -- Asistencia (si no cae por cascada)
  delete from public.employee_webauthn_credentials w
  where w.org_id = v_org_id
    and w.employee_id in (select id from tmp_test_employees);

  delete from public.employee_attendance_tokens t
  where t.org_id = v_org_id
    and t.employee_id in (select id from tmp_test_employees);

  delete from public.attendance a
  where a.org_id = v_org_id
    and a.employee_id in (select id from tmp_test_employees);

  delete from public.webauthn_challenges c
  where c.org_id = v_org_id
    and c.employee_id in (select id from tmp_test_employees);

  -- Cotizador (solo si se usó con datos de prueba)
  delete from public.service_quotes q
  where q.org_id = v_org_id
    and (
      q.client ilike 'SMOKE_TEST%'
      or q.client ilike 'VITEST%'
      or coalesce(q.address,'') ilike '%SMOKE_TEST%'
      or q.service_name ilike '%SMOKE_TEST%'
    );

  delete from public.material_price_quotes pq
  using public.material_catalog_items mi
  where pq.org_id = v_org_id
    and mi.id = pq.material_id
    and mi.org_id = pq.org_id
    and (mi.name ilike 'SMOKE_TEST%' or mi.name ilike 'VITEST_%');

  delete from public.material_catalog_items mi
  where mi.org_id = v_org_id
    and (mi.name ilike 'SMOKE_TEST%' or mi.name ilike 'VITEST_%');

  delete from public.apu_templates a
  where a.org_id = v_org_id
    and (a.name ilike 'SMOKE_TEST%' or a.name ilike 'VITEST_%');

  -- 4) Finalmente borrar proyectos de prueba (cascada limpia budgets/transactions/progress/etc)
  delete from public.projects p
  where p.org_id = v_org_id
    and p.id in (select id from tmp_test_projects);

  -- 5) Borrar empleados de prueba (cascada limpia attendance/tokens/webauthn_credentials, pero OJO: employee_contracts usa SET NULL)
  delete from public.employees e
  where e.org_id = v_org_id
    and e.id in (select id from tmp_test_employees);

  -- Nota: audit_logs
  -- Si quieres limpiar auditoría de prueba, lo más seguro es filtrar por patrones.
  -- Descomentá solo si estás seguro de no perder auditoría legítima.
  -- delete from public.audit_logs al
  -- where al.org_id = v_org_id
  --   and (
  --     al.table_name in ('projects','transactions','budgets','budget_lines','requisitions','employees')
  --     and (al.new_snapshot::text ilike '%SMOKE_TEST%' or al.old_snapshot::text ilike '%SMOKE_TEST%' or al.new_snapshot::text ilike '%VITEST%' or al.old_snapshot::text ilike '%VITEST%')
  --   );

end $$;

commit;
