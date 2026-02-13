-- Add real (invoice) unit cost per purchased material and allow admins to record it post-approval.

-- 1) Column
alter table public.requisition_items
  add column if not exists actual_unit_cost numeric(14,2)
  check (actual_unit_cost is null or actual_unit_cost >= 0);

-- 2) Protect item details after leaving draft (but allow unit prices updates)
create or replace function app.tg_requisition_items_guard_after_draft()
returns trigger
language plpgsql
security definer
set search_path = public, app, auth
as $$
declare
  req_status text;
begin
  select r.status
  into req_status
  from public.requisitions r
  where r.id = new.requisition_id
    and r.org_id = new.org_id;

  if req_status is null then
    return new;
  end if;

  if req_status <> 'draft' then
    if (new.name is distinct from old.name)
      or (new.unit is distinct from old.unit)
      or (new.quantity is distinct from old.quantity) then
      raise exception 'No se puede editar el detalle (nombre/unidad/cantidad) después de enviar la requisición.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists requisition_items_guard_after_draft on public.requisition_items;
create trigger requisition_items_guard_after_draft
before update on public.requisition_items
for each row
execute function app.tg_requisition_items_guard_after_draft();

-- 3) Allow org admins to update requisition items in any status (creator still limited to draft)
--    NOTE: This keeps tight control via the guard trigger above.
drop policy if exists requisition_items_update on public.requisition_items;
create policy requisition_items_update
on public.requisition_items
for update
to authenticated
using (
  app.is_org_member(org_id)
  and exists (
    select 1
    from public.requisitions r
    where r.id = requisition_id
      and r.org_id = org_id
      and (
        app.is_org_admin(org_id)
        or (r.created_by = auth.uid() and r.status = 'draft')
      )
  )
)
with check (
  app.is_org_member(org_id)
  and exists (
    select 1
    from public.requisitions r
    where r.id = requisition_id
      and r.org_id = org_id
      and (
        app.is_org_admin(org_id)
        or (r.created_by = auth.uid() and r.status = 'draft')
      )
  )
);

-- 4) Extend totals view with real (actual) total amount; keep existing column names for compatibility
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
  coalesce(sum(ri.quantity * coalesce(ri.unit_price, 0)), 0) as total_amount,
  coalesce(sum(ri.quantity * coalesce(ri.actual_unit_cost, 0)), 0) as actual_total_amount
from public.requisitions r
left join public.requisition_items ri on ri.requisition_id = r.id
left join public.suppliers s on s.id = r.supplier_id
group by r.id, s.name;
