-- Supabase (Postgres) schema for M&S-WM-CORP-4_App
-- Generated from UI logic in components/*
-- Date: 2026-02-04

begin;

-- Extensions
create extension if not exists pgcrypto;

-- Helper schema for functions/triggers
create schema if not exists app;

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

create or replace function app.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Membership helpers used in RLS policies.
-- SECURITY DEFINER ensures org membership checks work even when org_members has RLS.
-- NOTE: is_org_member/is_org_admin are defined after org_members table exists.

-- -----------------------------------------------------------------------------
-- Enums (match UI semantics)
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.project_status as enum ('standby', 'active', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.typology as enum ('RESIDENCIAL', 'COMERCIAL', 'INDUSTRIAL', 'CIVIL', 'PUBLICA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.transaction_type as enum ('INGRESO', 'GASTO');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.requisition_status as enum ('draft', 'sent', 'confirmed', 'received', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.employee_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payroll_status as enum ('draft', 'approved', 'paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.org_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Core multi-tenant security model
-- -----------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function app.tg_set_updated_at();

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_id_idx on public.org_members(user_id);

-- Membership helpers used in RLS policies.
-- SECURITY DEFINER ensures org membership checks work even when org_members has RLS.
create or replace function app.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function app.is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

-- Bootstrap: when an organization is created, automatically add the creator as owner.
create or replace function app.tg_organizations_add_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists organizations_add_owner on public.organizations;
create trigger organizations_add_owner
after insert on public.organizations
for each row
execute function app.tg_organizations_add_owner();

-- -----------------------------------------------------------------------------
-- Proyectos (components/Proyectos.tsx)
-- -----------------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,

  name text not null,
  client_name text not null,
  location text not null,
  lot text,
  block text,
  coordinates text,

  area_land numeric(12,2) not null check (area_land > 0),
  area_build numeric(12,2) not null check (area_build > 0),

  needs text not null default '',
  status public.project_status not null default 'standby',
  start_date date not null default (now() at time zone 'utc')::date,
  typology public.typology not null,
  project_manager text not null,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()

  ,constraint projects_id_org_unique unique (id, org_id)
);

create index if not exists projects_org_id_idx on public.projects(org_id);
create index if not exists projects_org_status_idx on public.projects(org_id, status);
create index if not exists projects_org_name_idx on public.projects(org_id, lower(name));
create index if not exists projects_org_client_idx on public.projects(org_id, lower(client_name));

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row
execute function app.tg_set_updated_at();

-- (file truncated in squash) --

commit;
