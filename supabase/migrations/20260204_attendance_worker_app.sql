-- Worker attendance (GPS + biometric payload via token)
-- Date: 2026-02-04

begin;

-- Token registry per employee for public check-in links (hashed tokens)
create table if not exists public.employee_attendance_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,

  token_hash text not null,
  is_active boolean not null default true,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint employee_attendance_tokens_id_org_unique unique (id, org_id),
  constraint employee_attendance_tokens_org_employee_unique unique (org_id, employee_id),
  constraint employee_attendance_tokens_employee_fk foreign key (employee_id, org_id)
    references public.employees(id, org_id) on delete cascade
);

create index if not exists employee_attendance_tokens_org_hash_idx on public.employee_attendance_tokens(org_id, token_hash);

drop trigger if exists employee_attendance_tokens_set_updated_at on public.employee_attendance_tokens;
create trigger employee_attendance_tokens_set_updated_at
before update on public.employee_attendance_tokens
for each row
execute function app.tg_set_updated_at();

alter table public.employee_attendance_tokens enable row level security;

drop policy if exists employee_attendance_tokens_crud on public.employee_attendance_tokens;
create policy employee_attendance_tokens_crud
on public.employee_attendance_tokens
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

-- Extend attendance to store extra GPS/biometric metadata
alter table public.attendance
  add column if not exists accuracy_m numeric(10,2),
  add column if not exists biometric jsonb,
  add column if not exists device jsonb,
  add column if not exists source text not null default 'worker_app';

-- Helper: set/rotate employee token (org members only)
create or replace function app.set_employee_attendance_token(p_employee_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_org_id uuid;
  v_hash text;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    raise exception 'Token inválido';
  end if;

  select e.org_id into v_org_id
  from public.employees e
  where e.id = p_employee_id;

  if v_org_id is null then
    raise exception 'Empleado no existe';
  end if;

  if not app.is_org_member(v_org_id) then
    raise exception 'No autorizado';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  insert into public.employee_attendance_tokens (org_id, employee_id, token_hash, is_active)
  values (v_org_id, p_employee_id, v_hash, true)
  on conflict (org_id, employee_id)
  do update set token_hash = excluded.token_hash, is_active = true, updated_at = now();
end;
$$;

revoke all on function app.set_employee_attendance_token(uuid, text) from public;
grant execute on function app.set_employee_attendance_token(uuid, text) to authenticated;

-- Public check-in/out (token-gated). Intended for worker device (no org membership).
drop function if exists app.submit_attendance_with_token(text, text, date, numeric, numeric, numeric, jsonb, jsonb);
create or replace function app.submit_attendance_with_token(
  p_token text,
  p_action text,
  p_lat numeric,
  p_lng numeric,
  p_work_date date default current_date,
  p_accuracy_m numeric default null,
  p_biometric jsonb default null,
  p_device jsonb default null
)
returns public.attendance
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_hash text;
  v_org_id uuid;
  v_employee_id uuid;
  v_project_id uuid;
  v_row public.attendance;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    raise exception 'Token inválido';
  end if;
  if p_action not in ('check_in', 'check_out') then
    raise exception 'Acción inválida';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Ubicación requerida';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select t.org_id, t.employee_id into v_org_id, v_employee_id
  from public.employee_attendance_tokens t
  where t.token_hash = v_hash and t.is_active = true
  limit 1;

  if v_org_id is null or v_employee_id is null then
    raise exception 'Token no válido o desactivado';
  end if;

  select e.project_id into v_project_id
  from public.employees e
  where e.id = v_employee_id and e.org_id = v_org_id;

  if p_action = 'check_in' then
    insert into public.attendance (
      org_id, employee_id, project_id,
      work_date, check_in,
      location_lat, location_lng,
      accuracy_m, biometric, device, source
    )
    values (
      v_org_id, v_employee_id, v_project_id,
      p_work_date, now(),
      p_lat, p_lng,
      p_accuracy_m, p_biometric, p_device, 'worker_app'
    )
    on conflict (employee_id, work_date)
    do update set
      check_in = excluded.check_in,
      location_lat = excluded.location_lat,
      location_lng = excluded.location_lng,
      accuracy_m = excluded.accuracy_m,
      biometric = excluded.biometric,
      device = excluded.device,
      source = excluded.source,
      updated_at = now()
    returning * into v_row;

    return v_row;
  end if;

  -- check_out
  update public.attendance a
  set
    check_out = now(),
    location_lat = p_lat,
    location_lng = p_lng,
    accuracy_m = p_accuracy_m,
    biometric = coalesce(p_biometric, a.biometric),
    device = coalesce(p_device, a.device),
    source = 'worker_app',
    updated_at = now()
  where a.org_id = v_org_id
    and a.employee_id = v_employee_id
    and a.work_date = p_work_date
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No existe entrada para hoy. Marque entrada primero.';
  end if;

  return v_row;
end;
$$;

revoke all on function app.submit_attendance_with_token(text, text, numeric, numeric, date, numeric, jsonb, jsonb) from public;
grant execute on function app.submit_attendance_with_token(text, text, numeric, numeric, date, numeric, jsonb, jsonb) to anon, authenticated;

-- Helpful view for admin map/list
create or replace view public.v_attendance_daily as
select
  a.id,
  a.org_id,
  a.employee_id,
  e.name as employee_name,
  e.phone as employee_phone,
  e.position as employee_position,
  a.project_id,
  p.name as project_name,
  a.work_date,
  a.check_in,
  a.check_out,
  a.location_lat,
  a.location_lng,
  a.accuracy_m,
  a.biometric,
  a.device,
  a.source,
  a.created_at,
  a.updated_at
from public.attendance a
join public.employees e on e.id = a.employee_id
left join public.projects p on p.id = a.project_id;

commit;
