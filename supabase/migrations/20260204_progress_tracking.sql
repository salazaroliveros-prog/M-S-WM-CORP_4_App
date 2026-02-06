-- Add physical progress tracking (Seguimiento)
-- Date: 2026-02-04

begin;

-- One editable progress record per project
create table if not exists public.project_progress (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_progress_one_per_project unique (project_id),
  constraint project_progress_id_org_unique unique (id, org_id),
  constraint project_progress_project_fk foreign key (project_id, org_id)
    references public.projects(id, org_id) on delete cascade
);

create index if not exists project_progress_org_project_idx on public.project_progress(org_id, project_id);

drop trigger if exists project_progress_set_updated_at on public.project_progress;
create trigger project_progress_set_updated_at
before update on public.project_progress
for each row
execute function app.tg_set_updated_at();

-- Progress lines are persisted by line name (budget line IDs are not stable)
create table if not exists public.project_progress_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  progress_id uuid not null,

  line_name text not null,
  line_unit text not null default 'Glb',
  planned_qty numeric(14,4) not null default 0 check (planned_qty >= 0),
  completed_qty numeric(14,4) not null default 0 check (completed_qty >= 0),
  notes text,
  sort_order int not null default 0,

  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_progress_lines_progress_fk foreign key (progress_id, org_id)
    references public.project_progress(id, org_id) on delete cascade
);

create index if not exists project_progress_lines_org_progress_idx on public.project_progress_lines(org_id, progress_id);

drop trigger if exists project_progress_lines_set_updated_at on public.project_progress_lines;
create trigger project_progress_lines_set_updated_at
before update on public.project_progress_lines
for each row
execute function app.tg_set_updated_at();

-- RLS
alter table public.project_progress enable row level security;
alter table public.project_progress_lines enable row level security;

drop policy if exists project_progress_crud on public.project_progress;
create policy project_progress_crud
on public.project_progress
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

drop policy if exists project_progress_lines_crud on public.project_progress_lines;
create policy project_progress_lines_crud
on public.project_progress_lines
for all
to authenticated
using (app.is_org_member(org_id))
with check (app.is_org_member(org_id));

commit;
