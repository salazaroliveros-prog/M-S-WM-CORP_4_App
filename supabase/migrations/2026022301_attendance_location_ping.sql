-- Attendance: location ping (token-gated, no biometric)
-- Date: 2026-02-23

begin;

-- Token-gated location pings for live tracking.
-- Does not create attendance records; requires an existing row for the day
-- (i.e. worker already checked in).
create or replace function app.ping_attendance_location_with_token(
  p_token text,
  p_lat numeric,
  p_lng numeric,
  p_work_date date default current_date,
  p_accuracy_m numeric default null,
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
  v_row public.attendance;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    raise exception 'Token inválido';
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

  update public.attendance a
  set
    location_lat = p_lat,
    location_lng = p_lng,
    accuracy_m = p_accuracy_m,
    device = coalesce(p_device, a.device),
    source = 'worker_ping',
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

revoke all on function app.ping_attendance_location_with_token(text, numeric, numeric, date, numeric, jsonb) from public;
grant execute on function app.ping_attendance_location_with_token(text, numeric, numeric, date, numeric, jsonb) to anon, authenticated;

-- Public wrapper (keeps client RPC name stable and simple).
create or replace function public.ping_attendance_location_with_token(
  p_token text,
  p_lat numeric,
  p_lng numeric,
  p_work_date date default current_date,
  p_accuracy_m numeric default null,
  p_device jsonb default null
)
returns public.attendance
language sql
security definer
set search_path = public, app
as $$
  select app.ping_attendance_location_with_token(
    p_token,
    p_lat,
    p_lng,
    p_work_date,
    p_accuracy_m,
    p_device
  );
$$;

revoke all on function public.ping_attendance_location_with_token(text, numeric, numeric, date, numeric, jsonb) from public;
grant execute on function public.ping_attendance_location_with_token(text, numeric, numeric, date, numeric, jsonb) to anon, authenticated;

commit;
