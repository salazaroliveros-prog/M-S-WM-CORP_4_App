-- Public RPC wrappers for Attendance/WebAuthn helpers
--
-- Supabase PostgREST typically exposes only the `public` schema by default.
-- Our attendance helpers live under the `app` schema, so we create `public.*`
-- wrappers to make `.rpc('fn_name')` work from supabase-js.

begin;

create or replace function public.set_employee_attendance_token(p_employee_id uuid, p_token text)
returns void
language sql
security definer
set search_path = public, app
as $$
  select app.set_employee_attendance_token(p_employee_id, p_token);
$$;

revoke all on function public.set_employee_attendance_token(uuid, text) from public;
grant execute on function public.set_employee_attendance_token(uuid, text) to authenticated;

create or replace function public.submit_attendance_with_token(
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
language sql
security definer
set search_path = public, app
as $$
  select app.submit_attendance_with_token(
    p_token,
    p_action,
    p_lat,
    p_lng,
    p_work_date,
    p_accuracy_m,
    p_biometric,
    p_device
  );
$$;

revoke all on function public.submit_attendance_with_token(text, text, numeric, numeric, date, numeric, jsonb, jsonb) from public;
grant execute on function public.submit_attendance_with_token(text, text, numeric, numeric, date, numeric, jsonb, jsonb) to anon, authenticated;

create or replace function public.get_attendance_token_info(p_token text)
returns table (org_id uuid, employee_id uuid, employee_name text)
language sql
security definer
set search_path = public, app
as $$
  select * from app.get_attendance_token_info(p_token);
$$;

revoke all on function public.get_attendance_token_info(text) from public;
grant execute on function public.get_attendance_token_info(text) to anon, authenticated;

commit;
