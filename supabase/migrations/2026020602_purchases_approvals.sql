-- Compras approvals workflow: status transitions + actor stamps + tighter RLS

-- Add audit/actor columns for procurement lifecycle
alter table public.requisitions
  add column if not exists sent_by uuid,
  add column if not exists confirmed_by uuid,
  add column if not exists received_by uuid,
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_at timestamptz;

-- Stamp actor + timestamps and enforce valid transitions
create or replace function app.tg_requisitions_status_workflow()
returns trigger
language plpgsql
security definer
set search_path = public, app, auth
as $$
begin
  -- Only validate when status changes
  if new.status is distinct from old.status then
    -- terminal
    if old.status = 'received' then
      raise exception 'No se puede cambiar una requisición ya recibida.';
    end if;

    -- transitions
    if new.status = 'sent' and old.status <> 'draft' then
      raise exception 'Transición inválida: % → %', old.status, new.status;
    end if;
    if new.status = 'confirmed' and old.status <> 'sent' then
      raise exception 'Transición inválida: % → %', old.status, new.status;
    end if;
    if new.status = 'received' and old.status <> 'confirmed' then
      raise exception 'Transición inválida: % → %', old.status, new.status;
    end if;
    if new.status = 'cancelled' and old.status not in ('draft', 'sent', 'confirmed') then
      raise exception 'Transición inválida: % → %', old.status, new.status;
    end if;

    -- stamps
    if new.status = 'sent' then
      new.sent_at := coalesce(new.sent_at, now());
      new.sent_by := auth.uid();
    elsif new.status = 'confirmed' then
      new.confirmed_at := coalesce(new.confirmed_at, now());
      new.confirmed_by := auth.uid();
    elsif new.status = 'received' then
      new.received_at := coalesce(new.received_at, now());
      new.received_by := auth.uid();
    elsif new.status = 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
      new.cancelled_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists requisitions_status_workflow on public.requisitions;
create trigger requisitions_status_workflow
before update on public.requisitions
for each row
execute function app.tg_requisitions_status_workflow();

-- RLS tightening: members can create + view; only admins can approve/receive;
-- creators can edit/cancel while draft/sent.

do $$ begin
  -- ensure RLS is enabled (idempotent)
  execute 'alter table public.requisitions enable row level security';
  execute 'alter table public.requisition_items enable row level security';
exception when others then null;
end $$;

-- Replace broad CRUD policies with granular ones

drop policy if exists requisitions_crud on public.requisitions;

drop policy if exists requisitions_select on public.requisitions;
create policy requisitions_select
on public.requisitions
for select
to authenticated
using (app.is_org_member(org_id));

drop policy if exists requisitions_insert on public.requisitions;
create policy requisitions_insert
on public.requisitions
for insert
to authenticated
with check (app.is_org_member(org_id));

drop policy if exists requisitions_update on public.requisitions;
create policy requisitions_update
on public.requisitions
for update
to authenticated
using (
  app.is_org_admin(org_id)
  or (
    created_by = auth.uid()
    and status in ('draft', 'sent')
  )
)
with check (
  app.is_org_admin(org_id)
  or (
    created_by = auth.uid()
    and status in ('draft', 'sent', 'cancelled')
  )
);

drop policy if exists requisitions_delete on public.requisitions;
create policy requisitions_delete
on public.requisitions
for delete
to authenticated
using (
  app.is_org_admin(org_id)
  or (
    created_by = auth.uid()
    and status in ('draft', 'sent', 'cancelled')
  )
);

-- Items: members can read; only admins or creator while requisition is draft can write

drop policy if exists requisition_items_crud on public.requisition_items;

drop policy if exists requisition_items_select on public.requisition_items;
create policy requisition_items_select
on public.requisition_items
for select
to authenticated
using (app.is_org_member(org_id));

drop policy if exists requisition_items_insert on public.requisition_items;
create policy requisition_items_insert
on public.requisition_items
for insert
to authenticated
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

drop policy if exists requisition_items_delete on public.requisition_items;
create policy requisition_items_delete
on public.requisition_items
for delete
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
);
