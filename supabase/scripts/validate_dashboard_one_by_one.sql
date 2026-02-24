-- Dashboard: validación 1:1 (Supabase ↔ UI)
--
-- Objetivo:
--   Generar los mismos números/series que construye el Dashboard en la app,
--   para compararlos uno por uno.
--
-- Cómo usar:
--   1) Abre Supabase SQL Editor
--   2) Edita el `insert into dashboard_params ... values (...)` (org/proyecto/rango/tz)
--   3) Ejecuta todo el script completo
--
-- Notas importantes:
--   - El Dashboard agrupa por fechas usando la zona horaria del dispositivo.
--     Aquí usamos por defecto 'America/Guatemala'. Si tu dispositivo usa otra,
--     cambia `tz` para que el agrupado diario/mensual coincida.
--   - El rango se interpreta como: desde `date_from` 00:00 local (incluye)
--     hasta `date_to` 23:59:59.999 local (incluye), implementado como end-exclusive.

-- IMPORTANT:
-- Supabase SQL Editor ejecuta múltiples sentencias separadas por ';'.
-- Los CTE (WITH ...) no se comparten entre sentencias, por eso creamos
-- objetos temporales reutilizables para todo el script.

drop view if exists dashboard_tx;
drop view if exists dashboard_projects;
drop view if exists dashboard_bounds;
drop table if exists dashboard_params;

create temporary table dashboard_params (
  org_id uuid not null,
  project_id uuid null,
  date_from date not null,
  date_to date not null,
  tz text not null
);


-- TODO: Ajusta estos parámetros y vuelve a ejecutar todo el script.
insert into dashboard_params (org_id, project_id, date_from, date_to, tz)
values (
  '26900cad-0091-462a-924c-051a31e35067'::uuid,
  null::uuid,
  '2026-02-01'::date,
  '2026-02-23'::date,
  'America/Guatemala'::text
);

create temporary view dashboard_bounds as
select
  p.org_id,
  p.project_id,
  p.date_from,
  p.date_to,
  p.tz,
  make_timestamptz(
    extract(year from p.date_from)::int,
    extract(month from p.date_from)::int,
    extract(day from p.date_from)::int,
    0, 0, 0,
    p.tz
  ) as start_ts,
  make_timestamptz(
    extract(year from (p.date_to + 1))::int,
    extract(month from (p.date_to + 1))::int,
    extract(day from (p.date_to + 1))::int,
    0, 0, 0,
    p.tz
  ) as end_ts
from dashboard_params p;

create temporary view dashboard_projects as
select pr.*
from public.projects pr
join dashboard_bounds b on pr.org_id = b.org_id;

create temporary view dashboard_tx as
select t.*
from public.transactions t
join dashboard_bounds b on t.org_id = b.org_id
where t.occurred_at >= b.start_ts
  and t.occurred_at < b.end_ts
  and (b.project_id is null or t.project_id = b.project_id);
-- -----------------------------------------------------------------------------
-- 1) KPI Cards
--   - Proyectos Activos
--   - Ingresos/Gastos/Utilidad/Margen (Rango)
-- -----------------------------------------------------------------------------
select
  'KPI' as section,
  (select start_ts from dashboard_bounds) as start_ts,
  (select end_ts from dashboard_bounds) as end_ts,
  count(*)::bigint as movimientos_rango,
  (select count(*) from dashboard_projects where status = 'active') as proyectos_activos,
  coalesce(sum(case when upper(coalesce(type::text, '')) = 'INGRESO' then coalesce(cost, 0) else 0 end), 0) as ingresos_rango,
  coalesce(sum(case when upper(coalesce(type::text, '')) = 'INGRESO' then 0 else coalesce(cost, 0) end), 0) as gastos_rango,
  coalesce(sum(case when upper(coalesce(type::text, '')) = 'INGRESO' then coalesce(cost, 0) else -coalesce(cost, 0) end), 0) as utilidad_neta,
  case
    when coalesce(sum(case when upper(coalesce(type::text, '')) = 'INGRESO' then coalesce(cost, 0) else 0 end), 0) > 0
      then (
        coalesce(sum(case when upper(coalesce(type::text, '')) = 'INGRESO' then coalesce(cost, 0) else -coalesce(cost, 0) end), 0)
        /
        coalesce(sum(case when upper(coalesce(type::text, '')) = 'INGRESO' then coalesce(cost, 0) else 0 end), 0)
      )
    else null
  end as margen
from dashboard_tx;

-- -----------------------------------------------------------------------------
-- 2) Flujo de Caja (Mensual - Rango)
--   - Serie mensual ingresos/gastos (agrupado por mes local)
-- -----------------------------------------------------------------------------
with b as (select * from dashboard_bounds),
months as (
  select
    to_char((t.occurred_at at time zone b.tz), 'YYYY-MM') as month_key,
    sum(case when upper(coalesce(t.type::text, '')) = 'INGRESO' then coalesce(t.cost, 0) else 0 end) as ingresos,
    sum(case when upper(coalesce(t.type::text, '')) = 'INGRESO' then 0 else coalesce(t.cost, 0) end) as gastos
  from dashboard_tx t
  cross join b
  group by 1
)
select
  'MONTHLY_SERIES' as section,
  month_key,
  round(ingresos)::bigint as ingresos,
  round(gastos)::bigint as gastos
from months
order by month_key;

-- -----------------------------------------------------------------------------
-- 3) Distribución por Tipología (proyectos)
-- -----------------------------------------------------------------------------
select
  'TIPOLOGIA' as section,
  case
    when typology = 'RESIDENCIAL' then 'Residencial'
    when typology = 'COMERCIAL' then 'Comercial'
    when typology = 'INDUSTRIAL' then 'Industrial'
    when typology = 'PUBLICA' then 'Pública'
    when typology = 'CIVIL' then 'Civil'
    else coalesce(typology::text, 'Sin tipología')
  end as name,
  count(*)::bigint as value
from dashboard_projects
where status = 'active'
group by 2
order by value desc, name;


-- -----------------------------------------------------------------------------
-- 4) Gastos por Categoría (Top)
-- -----------------------------------------------------------------------------
select
  'TOP_GASTOS_CATEGORIA' as section,
  coalesce(nullif(btrim(category), ''), 'Sin categoría') as name,
  round(sum(coalesce(cost, 0)))::bigint as value
from dashboard_tx
where upper(coalesce(type::text, '')) <> 'INGRESO'
group by 2
order by value desc
limit 8;

-- -----------------------------------------------------------------------------
-- 5) Ingresos por Categoría (Top)
-- -----------------------------------------------------------------------------
select
  'TOP_INGRESOS_CATEGORIA' as section,
  coalesce(nullif(btrim(category), ''), 'Sin categoría') as name,
  round(sum(coalesce(cost, 0)))::bigint as value
from dashboard_tx
where upper(coalesce(type::text, '')) = 'INGRESO'
group by 2
order by value desc
limit 8;

-- -----------------------------------------------------------------------------
-- 6) Gastos por Proveedor (Top)
-- -----------------------------------------------------------------------------
select
  'TOP_GASTOS_PROVEEDOR' as section,
  coalesce(nullif(btrim(provider), ''), 'Sin proveedor') as name,
  round(sum(coalesce(cost, 0)))::bigint as value
from dashboard_tx
where upper(coalesce(type::text, '')) <> 'INGRESO'
group by 2
order by value desc
limit 8;

-- -----------------------------------------------------------------------------
-- 7) Por Proyecto (Top)
--   - Ingresos vs Gastos (Top)
--   - Utilidad Neta (Top)
--   El Dashboard ordena por abs(neto) y limita a 8.
-- -----------------------------------------------------------------------------
with per_project as (
  select
    t.project_id,
    round(sum(case when upper(coalesce(t.type::text, '')) = 'INGRESO' then coalesce(t.cost, 0) else 0 end))::bigint as ingresos,
    round(sum(case when upper(coalesce(t.type::text, '')) = 'INGRESO' then 0 else coalesce(t.cost, 0) end))::bigint as gastos
  from dashboard_tx t
  where t.project_id is not null
  group by 1
),
joined as (
  select
    pp.project_id,
    coalesce(pr.name, pp.project_id::text) as name,
    pp.ingresos,
    pp.gastos,
    (pp.ingresos - pp.gastos) as neto
  from per_project pp
  left join dashboard_projects pr on pr.id = pp.project_id
)
select
  'TOP_PROYECTOS' as section,
  project_id,
  name,
  ingresos,
  gastos,
  neto
from joined
order by abs(neto) desc
limit 8;

-- -----------------------------------------------------------------------------
-- 8) Saldo Acumulado (Rango)
--   El Dashboard hace un acumulado ordenado por occurred_at.
--   Aquí devolvemos la serie completa y el saldo final.
-- -----------------------------------------------------------------------------
with b as (select * from dashboard_bounds),
ordered as (
  select
    t.id,
    t.occurred_at,
    (t.occurred_at at time zone b.tz) as occurred_local,
    case when upper(coalesce(t.type::text, '')) = 'INGRESO' then coalesce(t.cost, 0) else -coalesce(t.cost, 0) end as delta
  from dashboard_tx t
  cross join b
  order by t.occurred_at asc, t.id asc
),
series as (
  select
    id,
    occurred_at,
    occurred_local,
    sum(delta) over (order by occurred_at asc, id asc rows between unbounded preceding and current row) as saldo
  from ordered
)
select
  'CUMULATIVE_SERIES' as section,
  to_char(occurred_local, 'DD/MM') as name,
  occurred_at,
  round(saldo)::bigint as saldo
from series
order by occurred_at asc;

select
  'CUMULATIVE_FINAL' as section,
  coalesce(round(sum(case when upper(coalesce(type::text, '')) = 'INGRESO' then coalesce(cost, 0) else -coalesce(cost, 0) end))::bigint, 0) as saldo_final
from dashboard_tx;

-- -----------------------------------------------------------------------------
-- 9) Movimientos por Día
-- -----------------------------------------------------------------------------
with b as (select * from dashboard_bounds)
select
  'DAILY_COUNT' as section,
  to_char((t.occurred_at at time zone b.tz)::date, 'YYYY-MM-DD') as day_key,
  to_char((t.occurred_at at time zone b.tz)::date, 'DD/MM') as name,
  count(*)::bigint as value
from dashboard_tx t
cross join b
group by 2, 3
order by day_key;

-- -----------------------------------------------------------------------------
-- 10) Ingresos vs Gastos por Día
-- -----------------------------------------------------------------------------
with b as (select * from dashboard_bounds)
select
  'DAILY_FLOW' as section,
  to_char((t.occurred_at at time zone b.tz)::date, 'YYYY-MM-DD') as day_key,
  to_char((t.occurred_at at time zone b.tz)::date, 'DD/MM') as name,
  round(sum(case when upper(coalesce(t.type::text, '')) = 'INGRESO' then coalesce(t.cost, 0) else 0 end))::bigint as ingresos,
  round(sum(case when upper(coalesce(t.type::text, '')) = 'INGRESO' then 0 else coalesce(t.cost, 0) end))::bigint as gastos
from dashboard_tx t
cross join b
group by 2, 3
order by day_key;
