-- Verify actual (invoice) unit costs for purchased materials.
--
-- Purpose:
-- - Confirm the new column `requisition_items.actual_unit_cost` exists
-- - Confirm the view `v_requisition_totals.actual_total_amount` exists and matches sums
-- - Show coverage stats (how many items have actual cost)
-- - Highlight requisitions/projects with big deltas between planned total vs actual total
--
-- How to run:
-- - Supabase Dashboard → SQL Editor → run the whole script.
--
-- Assumption:
-- - Single-org environment. If you have multiple orgs, the script prints all orgs and auto-selects the org with MOST relevant purchasing data.

begin;

-- 1) Column exists?
select
  'requisition_items.actual_unit_cost' as check,
  case when exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'requisition_items'
      and column_name = 'actual_unit_cost'
  ) then 'OK' else 'MISSING' end as status;

-- 2) View includes actual_total_amount?
select
  'v_requisition_totals.actual_total_amount' as check,
  case when exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v_requisition_totals'
      and column_name = 'actual_total_amount'
  ) then 'OK' else 'MISSING' end as status;

-- 3) Choose org
with orgs as (
  select id, name, created_at
  from public.organizations
  order by created_at desc
)
select 'orgs' as section, id, name, created_at from orgs;

-- Per-org stats (helps diagnose when chosen org has no purchases yet)
with org_stats as (
  select
    o.id as org_id,
    o.name,
    o.created_at,
    (select count(*) from public.projects p where p.org_id = o.id) as projects,
    (select count(*) from public.requisitions r where r.org_id = o.id) as requisitions,
    (select count(*) from public.requisition_items ri where ri.org_id = o.id) as requisition_items,
    (select count(*) from public.v_requisition_totals vt where vt.org_id = o.id) as v_requisition_totals,
    (select count(*) from public.transactions t where t.org_id = o.id) as transactions
  from public.organizations o
)
select
  'org_stats' as section,
  org_id,
  name,
  created_at,
  projects,
  requisitions,
  requisition_items,
  v_requisition_totals,
  transactions
from org_stats
order by v_requisition_totals desc, requisition_items desc, requisitions desc, projects desc, transactions desc, created_at desc;

-- Persist chosen org so all later queries use the same org_id
drop table if exists pg_temp._verify_org;
create temp table _verify_org (
  org_id uuid not null
) on commit drop;

insert into pg_temp._verify_org (org_id)
select
  o.id
from public.organizations o
order by
  (select count(*) from public.v_requisition_totals vt where vt.org_id = o.id) desc,
  (select count(*) from public.requisition_items ri where ri.org_id = o.id) desc,
  (select count(*) from public.requisitions r where r.org_id = o.id) desc,
  (select count(*) from public.projects p where p.org_id = o.id) desc,
  (select count(*) from public.transactions t where t.org_id = o.id) desc,
  o.created_at desc
limit 1;

select 'chosen_org' as section, org_id from pg_temp._verify_org;

select
  'chosen_org_note' as section,
  case
    when (
      select count(*)
      from public.requisitions r
      join pg_temp._verify_org o on o.org_id = r.org_id
    ) = 0 then
      'NOTE: chosen org has 0 requisitions. That means v_requisition_totals will be empty; create a requisition + items to validate actual costs.'
    else
      'OK: chosen org has requisitions; script will validate totals and deltas.'
  end as message;

-- 4) Coverage stats
select
  'coverage' as section,
  count(*) as requisition_items_total,
  sum(case when ri.actual_unit_cost is not null then 1 else 0 end) as items_with_actual_unit_cost,
  sum(case when ri.actual_unit_cost is null then 1 else 0 end) as items_missing_actual_unit_cost,
  sum(case when ri.actual_unit_cost is not null and ri.actual_unit_cost = 0 then 1 else 0 end) as items_actual_unit_cost_zero
from public.requisition_items ri
join pg_temp._verify_org o on o.org_id = ri.org_id;

-- 5) Totals reconcile: view vs recompute
with view_totals as (
  select
    vt.requisition_id,
    vt.total_amount,
    vt.actual_total_amount
  from public.v_requisition_totals vt
  join pg_temp._verify_org o on o.org_id = vt.org_id
),
recomputed as (
  select
    r.id as requisition_id,
    coalesce(sum(ri.quantity * coalesce(ri.unit_price, 0)), 0) as total_amount_calc,
    coalesce(sum(ri.quantity * coalesce(ri.actual_unit_cost, 0)), 0) as actual_total_amount_calc
  from public.requisitions r
  left join public.requisition_items ri on ri.requisition_id = r.id and ri.org_id = r.org_id
  join pg_temp._verify_org o on o.org_id = r.org_id
  group by r.id
)
select
  'reconcile_debug' as section,
  (select count(*) from view_totals) as view_totals_rows,
  (select count(*) from recomputed) as recomputed_rows;

with view_totals as (
  select
    vt.requisition_id,
    vt.total_amount,
    vt.actual_total_amount
  from public.v_requisition_totals vt
  join pg_temp._verify_org o on o.org_id = vt.org_id
),
recomputed as (
  select
    r.id as requisition_id,
    coalesce(sum(ri.quantity * coalesce(ri.unit_price, 0)), 0) as total_amount_calc,
    coalesce(sum(ri.quantity * coalesce(ri.actual_unit_cost, 0)), 0) as actual_total_amount_calc
  from public.requisitions r
  left join public.requisition_items ri on ri.requisition_id = r.id and ri.org_id = r.org_id
  join pg_temp._verify_org o on o.org_id = r.org_id
  group by r.id
)
select
  'reconcile' as section,
  count(*) as requisitions_checked,
  coalesce(sum(case when abs(v.total_amount - c.total_amount_calc) < 0.01 then 1 else 0 end), 0) as total_amount_matches,
  coalesce(sum(case when abs(v.actual_total_amount - c.actual_total_amount_calc) < 0.01 then 1 else 0 end), 0) as actual_total_amount_matches
from view_totals v
join recomputed c using (requisition_id);

-- 6) Biggest deltas per requisition
select
  'requisition_deltas' as section,
  vt.requisition_id,
  vt.status,
  vt.requested_at,
  vt.total_amount,
  vt.actual_total_amount,
  (vt.actual_total_amount - vt.total_amount) as delta_amount
from public.v_requisition_totals vt
join pg_temp._verify_org o on o.org_id = vt.org_id
where vt.status in ('confirmed', 'received')
order by abs(vt.actual_total_amount - vt.total_amount) desc
limit 20;

-- 7) Project-level summary
select
  'project_summary' as section,
  p.id as project_id,
  p.name as project_name,
  coalesce(sum(vt.total_amount), 0) as planned_total_amount,
  coalesce(sum(vt.actual_total_amount), 0) as actual_total_amount,
  coalesce(sum(vt.actual_total_amount), 0) - coalesce(sum(vt.total_amount), 0) as delta_amount
from public.projects p
join pg_temp._verify_org o on o.org_id = p.org_id
left join public.v_requisition_totals vt on vt.project_id = p.id and vt.org_id = p.org_id
group by p.id, p.name
order by abs(coalesce(sum(vt.actual_total_amount), 0) - coalesce(sum(vt.total_amount), 0)) desc
limit 20;

commit;
