-- Tabla de stock de materiales por proyecto
create table if not exists public.project_material_stock (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  material_name text not null,
  unit text not null,
  budget_qty numeric(14,4) not null default 0, -- cantidad presupuestada
  purchased_qty numeric(14,4) not null default 0, -- cantidad comprada real
  remaining_qty numeric(14,4) not null default 0, -- cantidad restante
  updated_at timestamptz not null default now(),
  constraint project_material_stock_unique unique (project_id, material_name, unit)
);

-- Trigger para actualizar remaining_qty automáticamente
create or replace function app.tg_update_remaining_qty()
returns trigger as $$
begin
  new.remaining_qty := new.budget_qty - new.purchased_qty;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_remaining_qty on public.project_material_stock;
create trigger update_remaining_qty
before insert or update on public.project_material_stock
for each row execute function app.tg_update_remaining_qty();

-- Consulta para comparar lo presupuestado vs lo comprado real
-- (por proyecto y material)
-- Ejemplo de uso:
-- select material_name, unit, budget_qty, purchased_qty, remaining_qty
-- from public.project_material_stock
-- where project_id = '<PROJECT_ID>';

-- Lógica para actualizar el stock automáticamente al registrar una compra real
-- (ejemplo: después de insertar en requisition_items)
-- Puedes usar un trigger o hacerlo desde la app/backend:
--
-- 1. Al registrar una compra real:
--   - Busca el registro en project_material_stock por project_id, material_name, unit
--   - Suma la cantidad comprada a purchased_qty
--   - El trigger actualizará remaining_qty automáticamente
--
-- Ejemplo de trigger para actualizar stock al insertar en requisition_items:

create or replace function app.after_insert_requisition_item_update_stock()
returns trigger as $$
declare
  v_stock_id uuid;
begin
  select id into v_stock_id from public.project_material_stock
    where project_id = new.project_id and material_name = new.name and unit = new.unit;
  if v_stock_id is not null then
    update public.project_material_stock
      set purchased_qty = purchased_qty + new.quantity
      where id = v_stock_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists after_insert_requisition_item_update_stock on public.requisition_items;
create trigger after_insert_requisition_item_update_stock
after insert on public.requisition_items
for each row execute function app.after_insert_requisition_item_update_stock();
