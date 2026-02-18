-- Fix RLS policies to avoid per-row evaluation of auth.uid()
-- Date: 2026-02-18
-- This migration is idempotent: it drops/recreates policies with the
-- same logic but wrapping auth.uid() as (select auth.uid()).

begin;

-- -----------------------------------------------------------------------------
-- Organizations / org_members bootstrap policies (from scripts/fix_org_insert_policy.sql)
-- -----------------------------------------------------------------------------

drop policy if exists organizations_select on public.organizations;
create policy organizations_select
on public.organizations
for select
to anon, authenticated
using (
  app.is_org_member(id)
  or created_by = (select auth.uid())
);

drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert
on public.organizations
for insert
to anon, authenticated
with check (
  created_by = (select auth.uid())
);

-- org_members: select

drop policy if exists org_members_select on public.org_members;
create policy org_members_select
on public.org_members
for select
to anon, authenticated
using (
  -- Miembro viendo su propia fila
  user_id = (select auth.uid())
  -- O el creador de la organización viendo cualquier miembro de su org
  or exists (
    select 1 from public.organizations o
    where o.id = org_id
      and o.created_by = (select auth.uid())
  )
);

-- org_members: insert

drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert
on public.org_members
for insert
to anon, authenticated
with check (
  -- Usuario insertando su propia membresía
  (user_id = (select auth.uid())
   and exists (
     select 1 from public.organizations o
     where o.id = org_id
       and o.created_by = (select auth.uid())
   )
  )
  -- O el creador de la organización gestionando miembros
  or exists (
    select 1 from public.organizations o
    where o.id = org_id
      and o.created_by = (select auth.uid())
  )
);

-- -----------------------------------------------------------------------------
-- Audit logs
-- -----------------------------------------------------------------------------

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert
on public.audit_logs
for insert
to authenticated
with check (
  app.is_org_member(org_id)
  and actor_user_id = (select auth.uid())
);

-- -----------------------------------------------------------------------------
-- Requisitions + requisition_items (purchases approvals)
-- -----------------------------------------------------------------------------

drop policy if exists requisitions_update on public.requisitions;
create policy requisitions_update
on public.requisitions
for update
to authenticated
using (
  app.is_org_admin(org_id)
  or (
    created_by = (select auth.uid())
    and status in ('draft', 'sent')
  )
)
with check (
  app.is_org_admin(org_id)
  or (
    created_by = (select auth.uid())
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
    created_by = (select auth.uid())
    and status in ('draft', 'sent', 'cancelled')
  )
);

-- requisition_items policies (select/insert defined in previous migration
-- without auth.uid(); we only need to override the ones that reference it)

-- Insert

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
        or (r.created_by = (select auth.uid()) and r.status = 'draft')
      )
  )
);

-- Update (definition from 20260209_requisition_items_actual_unit_cost.sql,
-- but with auth.uid() wrapped)

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
        or (r.created_by = (select auth.uid()) and r.status = 'draft')
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
        or (r.created_by = (select auth.uid()) and r.status = 'draft')
      )
  )
);

-- Delete

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
        or (r.created_by = (select auth.uid()) and r.status = 'draft')
      )
  )
);

-- -----------------------------------------------------------------------------
-- Chat (messages / threads)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'org_id'
    ) THEN
      DROP POLICY IF EXISTS messages_select_policy ON public.messages;
      CREATE POLICY messages_select_policy
        ON public.messages FOR SELECT TO authenticated
        USING (
          exists (
            select 1 from public.org_members m
            where m.org_id = messages.org_id
              and m.user_id = (select auth.uid())
          )
        );

      DROP POLICY IF EXISTS messages_insert_policy ON public.messages;
      CREATE POLICY messages_insert_policy
        ON public.messages FOR INSERT TO authenticated
        WITH CHECK (
          exists (
            select 1 from public.org_members m
            where m.org_id = messages.org_id
              and m.user_id = (select auth.uid())
          )
        );

      DROP POLICY IF EXISTS messages_update_policy ON public.messages;
      CREATE POLICY messages_update_policy
        ON public.messages FOR UPDATE TO authenticated
        USING (
          exists (
            select 1 from public.org_members m
            where m.org_id = messages.org_id
              and m.user_id = (select auth.uid())
          )
        );

      DROP POLICY IF EXISTS messages_delete_policy ON public.messages;
      CREATE POLICY messages_delete_policy
        ON public.messages FOR DELETE TO authenticated
        USING (
          exists (
            select 1 from public.org_members m
            where m.org_id = messages.org_id
              and m.user_id = (select auth.uid())
              and m.role in ('owner','admin')
          )
        );
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.threads') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'threads' AND column_name = 'org_id'
    ) THEN
      DROP POLICY IF EXISTS threads_select_policy ON public.threads;
      CREATE POLICY threads_select_policy
        ON public.threads FOR SELECT TO authenticated
        USING (
          exists (
            select 1 from public.org_members m
            where m.org_id = threads.org_id
              and m.user_id = (select auth.uid())
          )
        );

      DROP POLICY IF EXISTS threads_insert_policy ON public.threads;
      CREATE POLICY threads_insert_policy
        ON public.threads FOR INSERT TO authenticated
        WITH CHECK (
          exists (
            select 1 from public.org_members m
            where m.org_id = threads.org_id
              and m.user_id = (select auth.uid())
          )
        );

      DROP POLICY IF EXISTS threads_update_policy ON public.threads;
      CREATE POLICY threads_update_policy
        ON public.threads FOR UPDATE TO authenticated
        USING (
          exists (
            select 1 from public.org_members m
            where m.org_id = threads.org_id
              and m.user_id = (select auth.uid())
          )
        );

      DROP POLICY IF EXISTS threads_delete_policy ON public.threads;
      CREATE POLICY threads_delete_policy
        ON public.threads FOR DELETE TO authenticated
        USING (
          exists (
            select 1 from public.org_members m
            where m.org_id = threads.org_id
              and m.user_id = (select auth.uid())
              and m.role in ('owner','admin')
          )
        );
    END IF;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- perfiles / trabajadores (self-profile policies)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.perfiles') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'perfiles' AND column_name = 'user_id'
    ) THEN
      DROP POLICY IF EXISTS perfiles_view_own ON public.perfiles;
      CREATE POLICY perfiles_view_own
        ON public.perfiles FOR SELECT TO authenticated
        USING (user_id = (select auth.uid()));

      DROP POLICY IF EXISTS perfiles_update_own ON public.perfiles;
      CREATE POLICY perfiles_update_own
        ON public.perfiles FOR UPDATE TO authenticated
        USING (user_id = (select auth.uid()))
        WITH CHECK (user_id = (select auth.uid()));
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.trabajadores') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'trabajadores' AND column_name = 'user_id'
    ) THEN
      DROP POLICY IF EXISTS trabajadores_view_own ON public.trabajadores;
      CREATE POLICY trabajadores_view_own
        ON public.trabajadores FOR SELECT TO authenticated
        USING (user_id = (select auth.uid()));
    END IF;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- Material catalog / price quotes (org-based admin policies)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.material_catalog_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS material_catalog_items_select ON public.material_catalog_items;
    CREATE POLICY material_catalog_items_select
      ON public.material_catalog_items FOR SELECT TO authenticated
      USING (true);

    DROP POLICY IF EXISTS material_catalog_items_write ON public.material_catalog_items;
    CREATE POLICY material_catalog_items_write
      ON public.material_catalog_items FOR ALL TO authenticated
      USING (
        exists (
          select 1 from public.org_members m
          where m.org_id = material_catalog_items.org_id
            and m.user_id = (select auth.uid())
            and m.role in ('owner','admin')
        )
      )
      WITH CHECK (
        exists (
          select 1 from public.org_members m
          where m.org_id = material_catalog_items.org_id
            and m.user_id = (select auth.uid())
            and m.role in ('owner','admin')
        )
      );
  END IF;

  IF to_regclass('public.material_price_quotes') IS NOT NULL THEN
    DROP POLICY IF EXISTS material_price_quotes_select ON public.material_price_quotes;
    CREATE POLICY material_price_quotes_select
      ON public.material_price_quotes FOR SELECT TO authenticated
      USING (
        exists (
          select 1 from public.org_members m
          where m.org_id = material_price_quotes.org_id
            and m.user_id = (select auth.uid())
        )
      );

    DROP POLICY IF EXISTS material_price_quotes_write ON public.material_price_quotes;
    CREATE POLICY material_price_quotes_write
      ON public.material_price_quotes FOR ALL TO authenticated
      USING (
        exists (
          select 1 from public.org_members m
          where m.org_id = material_price_quotes.org_id
            and m.user_id = (select auth.uid())
            and m.role in ('owner','admin')
        )
      )
      WITH CHECK (
        exists (
          select 1 from public.org_members m
          where m.org_id = material_price_quotes.org_id
            and m.user_id = (select auth.uid())
            and m.role in ('owner','admin')
        )
      );
  END IF;
END;
$$;

commit;
