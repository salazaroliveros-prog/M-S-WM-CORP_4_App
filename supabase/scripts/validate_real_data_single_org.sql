-- Validación de datos reales (asume UNA sola organización)
--
-- Uso:
-- 1) Supabase Dashboard → SQL Editor
-- 2) Ejecutar completo
--
-- Si tienes más de 1 org, el script igual funciona pero tomará la más reciente.

-- -----------------------------------------------------------------------------
-- 0) Descubrir organización activa
-- -----------------------------------------------------------------------------

select id as org_id, name, created_at
from public.organizations
order by created_at desc;

with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select org_id as detected_org_id from org;

-- -----------------------------------------------------------------------------
-- 1) Conteos por tabla (por org)
-- -----------------------------------------------------------------------------

with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select *
from (
  select 'projects' as table_name, count(*)::bigint as rows from public.projects p join org on p.org_id = org.org_id
  union all select 'transactions', count(*)::bigint from public.transactions t join org on t.org_id = org.org_id
  union all select 'budgets', count(*)::bigint from public.budgets b join org on b.org_id = org.org_id
  union all select 'budget_lines', count(*)::bigint from public.budget_lines bl join org on bl.org_id = org.org_id
  union all select 'budget_line_materials', count(*)::bigint from public.budget_line_materials blm join org on blm.org_id = org.org_id
  union all select 'suppliers', count(*)::bigint from public.suppliers s join org on s.org_id = org.org_id
  union all select 'requisitions', count(*)::bigint from public.requisitions r join org on r.org_id = org.org_id
  union all select 'requisition_items', count(*)::bigint from public.requisition_items ri join org on ri.org_id = org.org_id
  union all select 'employees', count(*)::bigint from public.employees e join org on e.org_id = org.org_id
  union all select 'employee_contracts', count(*)::bigint from public.employee_contracts c join org on c.org_id = org.org_id
  union all select 'attendance', count(*)::bigint from public.attendance a join org on a.org_id = org.org_id
  union all select 'employee_attendance_tokens', count(*)::bigint from public.employee_attendance_tokens tok join org on tok.org_id = org.org_id
  union all select 'org_pay_rates', count(*)::bigint from public.org_pay_rates pr join org on pr.org_id = org.org_id
  union all select 'employee_rate_overrides', count(*)::bigint from public.employee_rate_overrides ero join org on ero.org_id = org.org_id
  union all select 'service_quotes', count(*)::bigint from public.service_quotes sq join org on sq.org_id = org.org_id
  union all select 'project_progress', count(*)::bigint from public.project_progress pp join org on pp.org_id = org.org_id
  union all select 'project_progress_lines', count(*)::bigint from public.project_progress_lines ppl join org on ppl.org_id = org.org_id
  union all select 'material_catalog_items', count(*)::bigint from public.material_catalog_items mci join org on mci.org_id = org.org_id
  union all select 'material_price_quotes', count(*)::bigint from public.material_price_quotes mpq join org on mpq.org_id = org.org_id
  union all select 'apu_templates', count(*)::bigint from public.apu_templates apu join org on apu.org_id = org.org_id
  union all select 'audit_logs', count(*)::bigint from public.audit_logs al join org on al.org_id = org.org_id
) t
order by table_name;

-- -----------------------------------------------------------------------------
-- 2) Chequeos de integridad (órfanos / inconsistencias)
-- -----------------------------------------------------------------------------

-- 2.1 transactions con project inexistente (no debería pasar por FK)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as orphan_transactions
from public.transactions t
join org on t.org_id = org.org_id
left join public.projects p on p.id = t.project_id and p.org_id = t.org_id
where p.id is null;

-- 2.2 budgets sin project (no debería pasar por FK)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as orphan_budgets
from public.budgets b
join org on b.org_id = org.org_id
left join public.projects p on p.id = b.project_id and p.org_id = b.org_id
where p.id is null;

-- 2.3 requisitions sin items
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as requisitions_without_items
from public.requisitions r
join org on r.org_id = org.org_id
left join public.requisition_items ri on ri.requisition_id = r.id and ri.org_id = r.org_id
where ri.id is null;

-- 2.4 attendance con employee inexistente (no debería pasar por FK)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as orphan_attendance
from public.attendance a
join org on a.org_id = org.org_id
left join public.employees e on e.id = a.employee_id and e.org_id = a.org_id
where e.id is null;

-- 2.5 budget_lines sin budget (no debería pasar por FK)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as orphan_budget_lines
from public.budget_lines bl
join org on bl.org_id = org.org_id
left join public.budgets b on b.id = bl.budget_id and b.org_id = bl.org_id
where b.id is null;

-- 2.6 budget_line_materials sin budget_line (no debería pasar por FK)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as orphan_budget_line_materials
from public.budget_line_materials blm
join org on blm.org_id = org.org_id
left join public.budget_lines bl on bl.id = blm.budget_line_id and bl.org_id = blm.org_id
where bl.id is null;

-- 2.7 requisition_items sin requisition (no debería pasar por FK)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as orphan_requisition_items
from public.requisition_items ri
join org on ri.org_id = org.org_id
left join public.requisitions r on r.id = ri.requisition_id and r.org_id = ri.org_id
where r.id is null;

-- 2.8 employee_rate_overrides sin employee (no debería pasar por FK)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as orphan_employee_rate_overrides
from public.employee_rate_overrides o
join org on o.org_id = org.org_id
left join public.employees e on e.id = o.employee_id and e.org_id = o.org_id
where e.id is null;

-- 2.9 attendance con check_out antes de check_in (sanity)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as attendance_invalid_time
from public.attendance a
join org on a.org_id = org.org_id
where a.check_out is not null
  and a.check_out < a.check_in;

-- 2.10 budgets duplicados por project_id (debería ser 0 por UNIQUE)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select count(*)::bigint as duplicated_budgets_per_project
from (
  select b.project_id
  from public.budgets b
  join org on b.org_id = org.org_id
  group by b.project_id
  having count(*) > 1
) x;

-- 2.11 posiciones de employees fuera del check (si existen, UI no debería permitir)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select position, count(*)::bigint
from public.employees e
join org on e.org_id = org.org_id
group by position
order by count(*) desc;

-- -----------------------------------------------------------------------------
-- 2.SUMMARY) Resumen compacto (todo lo anterior en una sola fila)
-- -----------------------------------------------------------------------------

with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select
  -- orphans
  (select count(*) from public.transactions t join org on t.org_id = org.org_id
    left join public.projects p on p.id = t.project_id and p.org_id = t.org_id
    where p.id is null) as orphan_transactions,
  (select count(*) from public.budgets b join org on b.org_id = org.org_id
    left join public.projects p on p.id = b.project_id and p.org_id = b.org_id
    where p.id is null) as orphan_budgets,
  (select count(*) from public.budget_lines bl join org on bl.org_id = org.org_id
    left join public.budgets b on b.id = bl.budget_id and b.org_id = bl.org_id
    where b.id is null) as orphan_budget_lines,
  (select count(*) from public.budget_line_materials blm join org on blm.org_id = org.org_id
    left join public.budget_lines bl on bl.id = blm.budget_line_id and bl.org_id = blm.org_id
    where bl.id is null) as orphan_budget_line_materials,
  (select count(*) from public.requisition_items ri join org on ri.org_id = org.org_id
    left join public.requisitions r on r.id = ri.requisition_id and r.org_id = ri.org_id
    where r.id is null) as orphan_requisition_items,
  (select count(*) from public.attendance a join org on a.org_id = org.org_id
    left join public.employees e on e.id = a.employee_id and e.org_id = a.org_id
    where e.id is null) as orphan_attendance,
  (select count(*) from public.employee_rate_overrides o join org on o.org_id = org.org_id
    left join public.employees e on e.id = o.employee_id and e.org_id = o.org_id
    where e.id is null) as orphan_employee_rate_overrides,

  -- sanity
  (select count(*) from public.requisitions r join org on r.org_id = org.org_id
    left join public.requisition_items ri on ri.requisition_id = r.id and ri.org_id = r.org_id
    where ri.id is null) as requisitions_without_items,
  (select count(*) from public.attendance a join org on a.org_id = org.org_id
    where a.check_out is not null and a.check_out < a.check_in) as attendance_invalid_time,
  (select count(*) from (
      select b.project_id
      from public.budgets b
      join org on b.org_id = org.org_id
      group by b.project_id
      having count(*) > 1
    ) x) as duplicated_budgets_per_project;

-- -----------------------------------------------------------------------------
-- 3) Chequeos “anti-datos-de-prueba” (debería dar 0)
-- -----------------------------------------------------------------------------

with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select
  (select count(*) from public.projects p join org on p.org_id = org.org_id where p.name ilike 'SMOKE_TEST%' or p.name ilike 'VITEST_%') as projects_test,
  (select count(*) from public.transactions t join org on t.org_id = org.org_id where t.description ilike 'SMOKE_TEST%' or t.description ilike 'VITEST_%' or t.category ilike 'SMOKE_TEST%') as transactions_test,
  (select count(*) from public.suppliers s join org on s.org_id = org.org_id where s.name ilike 'SMOKE_TEST%' or s.name ilike 'VITEST_SUPP_%') as suppliers_test,
  (select count(*) from public.employees e join org on e.org_id = org.org_id where e.name ilike 'SMOKE_TEST%' or e.name ilike 'VITEST_%') as employees_test,
  (select count(*) from public.org_pay_rates pr join org on pr.org_id = org.org_id where pr.role ilike 'SMOKE_TEST_ROLE_%') as pay_rates_test;

-- -----------------------------------------------------------------------------
-- 4) Muestras de datos recientes (sanity check visual)
-- -----------------------------------------------------------------------------

-- Proyectos recientes
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select p.id, p.name, p.client_name, p.status, p.start_date, p.updated_at
from public.projects p
join org on p.org_id = org.org_id
order by p.created_at desc
limit 20;

-- Transacciones recientes
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select t.id, t.project_id, t.type, t.description, t.amount, t.cost, t.category, t.occurred_at, t.provider, t.rent_end_date
from public.transactions t
join org on t.org_id = org.org_id
order by t.occurred_at desc
limit 30;

-- Requisiciones recientes (con total)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select rt.requisition_id, rt.project_id, rt.supplier_name, rt.status, rt.requested_at, rt.total_amount
from public.v_requisition_totals rt
join org on rt.org_id = org.org_id
order by rt.requested_at desc
limit 20;

-- Empleados recientes
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select e.id, e.name, e.position, e.daily_rate, e.status, e.project_id, e.created_at
from public.employees e
join org on e.org_id = org.org_id
order by e.created_at desc
limit 20;

-- Asistencia del día (si hay)
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select a.work_date, a.employee_name, a.project_name, a.check_in, a.check_out, a.source
from public.v_attendance_daily a
join org on a.org_id = org.org_id
where a.work_date >= (now() at time zone 'utc')::date - 7
order by a.work_date desc, a.check_in desc
limit 50;

-- Auditoría reciente
with org as (
  select id as org_id
  from public.organizations
  order by created_at desc
  limit 1
)
select al.created_at, al.action, al.table_name, al.record_id, al.project_id
from public.audit_logs al
join org on al.org_id = org.org_id
order by al.created_at desc
limit 50;
