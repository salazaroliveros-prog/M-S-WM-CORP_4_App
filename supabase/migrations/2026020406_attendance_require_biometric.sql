-- Enforce biometric payload on token-based attendance submission
-- Date: 2026-02-04

begin;

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
  v_method text;
  v_verified boolean;
  v_cred text;
  v_code text;
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

  if p_biometric is null then
    raise exception 'Biometría requerida';
  end if;
  if jsonb_typeof(p_biometric) <> 'object' then
    raise exception 'Formato de biometría inválido';
  end if;

  v_method := coalesce(p_biometric->>'method', '');
  if v_method = 'webauthn' then
    v_verified := coalesce((p_biometric->>'verified')::boolean, false);
    v_cred := coalesce(p_biometric->>'credentialId', '');
    if v_verified is not true then
      raise exception 'Biometría no verificada';
    end if;
    if length(v_cred) < 8 then
      raise exception 'Credencial WebAuthn inválida';
    end if;
  elsif v_method = 'code' then
    v_code := coalesce(p_biometric->>'code', '');
    if length(trim(v_code)) < 3 then
      raise exception 'Código biométrico requerido';
    end if;
  else
    raise exception 'Método biométrico inválido';
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

  update public.attendance a
  set
    check_out = now(),
    location_lat = p_lat,
    location_lng = p_lng,
    accuracy_m = p_accuracy_m,
    biometric = p_biometric,
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

commit;
