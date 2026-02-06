-- Public RPC to allow applicants to submit their filled contract response
--
-- This enables RRHH to send a link via WhatsApp and receive the contract already filled
-- without requiring manual copy/paste of the response code.
--
-- Security model:
-- - RRHH creates a `employee_contracts` row with a random UUID `request_id`.
-- - Applicant submits `response` for that request_id.
-- - The RPC is SECURITY DEFINER and only updates that single row.
-- - request_id is treated as an unguessable capability token.
--
-- Date: 2026-02-06

begin;

create or replace function public.submit_employee_contract_response(
  p_request_id uuid,
  p_response jsonb
)
returns public.employee_contracts
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_row public.employee_contracts;
  v_accepted boolean;
  v_dpi text;
  v_phone text;
  v_start_date text;
  v_response_req uuid;
  v_now timestamptz := now();
begin
  if p_request_id is null then
    raise exception 'requestId requerido.';
  end if;
  if p_response is null then
    raise exception 'response requerido.';
  end if;

  -- Basic consistency check: response must include same requestId
  begin
    v_response_req := nullif(p_response->>'requestId', '')::uuid;
  exception when others then
    v_response_req := null;
  end;
  if v_response_req is null or v_response_req <> p_request_id then
    raise exception 'requestId no coincide.';
  end if;

  v_accepted := coalesce((p_response->>'accepted')::boolean, false);
  if not v_accepted then
    raise exception 'Debe aceptar la confirmación.';
  end if;

  v_dpi := btrim(coalesce(p_response->>'dpi', ''));
  v_phone := btrim(coalesce(p_response->>'phone', ''));
  v_start_date := btrim(coalesce(p_response->>'startDate', ''));
  if v_dpi = '' then raise exception 'DPI / CUI requerido.'; end if;
  if v_phone = '' then raise exception 'Teléfono requerido.'; end if;
  if v_start_date = '' then raise exception 'Fecha de inicio requerida.'; end if;

  select * into v_row
  from public.employee_contracts
  where request_id = p_request_id
  order by requested_at desc
  limit 1;

  if v_row.id is null then
    raise exception 'Solicitud de contrato no encontrada. Solicita un nuevo link a RRHH.';
  end if;
  if v_row.status = 'void' then
    raise exception 'Solicitud de contrato anulada.';
  end if;

  -- Idempotent behavior: if already received, do not overwrite.
  if v_row.status = 'received' and v_row.responded_at is not null then
    return v_row;
  end if;

  update public.employee_contracts
    set status = 'received',
        response = p_response,
        responded_at = coalesce(nullif(p_response->>'responseAt','')::timestamptz, v_now),
        updated_at = v_now
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.submit_employee_contract_response(uuid, jsonb) from public;
grant execute on function public.submit_employee_contract_response(uuid, jsonb) to anon, authenticated;

commit;
