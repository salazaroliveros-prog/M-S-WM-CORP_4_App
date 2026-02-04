-- WebAuthn credentials for worker biometrics
-- Date: 2026-02-04

begin;

create table if not exists public.employee_webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,

  credential_id text not null,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_label text,
  is_active boolean not null default true,

  last_used_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint employee_webauthn_credentials_id_org_unique unique (id, org_id),
  constraint employee_webauthn_credentials_credential_unique unique (org_id, credential_id),
  constraint employee_webauthn_credentials_employee_fk foreign key (employee_id, org_id)
    references public.employees(id, org_id) on delete cascade
);

create index if not exists employee_webauthn_credentials_org_employee_idx on public.employee_webauthn_credentials(org_id, employee_id);

drop trigger if exists employee_webauthn_credentials_set_updated_at on public.employee_webauthn_credentials;
create trigger employee_webauthn_credentials_set_updated_at
before update on public.employee_webauthn_credentials
for each row
execute function app.tg_set_updated_at();

alter table public.employee_webauthn_credentials enable row level security;

drop policy if exists employee_webauthn_credentials_crud on public.employee_webauthn_credentials;
create policy employee_webauthn_credentials_crud
on public.employee_webauthn_credentials
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

-- Challenge storage for edge functions (service role only; no policies)
create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  token_hash text not null,

  kind text not null check (kind in ('registration', 'authentication')),
  challenge text not null,
  expires_at timestamptz not null,

  created_at timestamptz not null default now()
);

create index if not exists webauthn_challenges_lookup_idx on public.webauthn_challenges(org_id, employee_id, token_hash, kind, created_at desc);

alter table public.webauthn_challenges enable row level security;

-- Public helper for worker UI (minimal disclosure)
create or replace function app.get_attendance_token_info(p_token text)
returns table (org_id uuid, employee_id uuid, employee_name text)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_hash text;
begin
  if p_token is null or length(trim(p_token)) < 16 then
    raise exception 'Token inválido';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  return query
  select t.org_id, t.employee_id, e.name
  from public.employee_attendance_tokens t
  join public.employees e on e.id = t.employee_id and e.org_id = t.org_id
  where t.token_hash = v_hash and t.is_active = true
  limit 1;
end;
$$;

revoke all on function app.get_attendance_token_info(text) from public;
grant execute on function app.get_attendance_token_info(text) to anon, authenticated;

commit;
