-- Migration: sync RLS policies and Realtime publication
-- Date: 2026-02-10
-- This script is idempotent: it checks table existence, drops policies if present, and recreates
-- a set of standard policies for the app. It also ensures the 'supabase_realtime' publication
-- contains the application tables when Realtime is enabled.

DO $$
DECLARE
  v_pubname text := 'supabase_realtime';
BEGIN
  RAISE NOTICE 'Starting migration: sync RLS + publication (publication=%).', v_pubname;
END;
$$;

-- Utility: enable RLS if table exists
DO $$
BEGIN
  PERFORM 1; -- noop block to keep form
END;
$$;

-- Create/replace policies for commonly used tables (only when table exists)

-- Messages / Threads / Chat
DO $$
BEGIN
  IF to_regclass('public.messages') IS NOT NULL THEN
    -- Only create org-based policies when the table contains an 'org_id' column
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'org_id'
    ) THEN
      DROP POLICY IF EXISTS messages_select_policy ON public.messages;
      CREATE POLICY messages_select_policy
        ON public.messages FOR SELECT TO authenticated
        USING (exists (select 1 from public.org_members m where m.org_id = messages.org_id and m.user_id = auth.uid()));

      DROP POLICY IF EXISTS messages_insert_policy ON public.messages;
      CREATE POLICY messages_insert_policy
        ON public.messages FOR INSERT TO authenticated
        WITH CHECK (exists (select 1 from public.org_members m where m.org_id = messages.org_id and m.user_id = auth.uid()));

      DROP POLICY IF EXISTS messages_update_policy ON public.messages;
      CREATE POLICY messages_update_policy
        ON public.messages FOR UPDATE TO authenticated
        USING (exists (select 1 from public.org_members m where m.org_id = messages.org_id and m.user_id = auth.uid()));

      DROP POLICY IF EXISTS messages_delete_policy ON public.messages;
      CREATE POLICY messages_delete_policy
        ON public.messages FOR DELETE TO authenticated
        USING (exists (select 1 from public.org_members m where m.org_id = messages.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
    ELSE
      RAISE NOTICE 'Skipping messages policies: column public.messages.org_id not found';
    END IF;
  END IF;

  IF to_regclass('public.threads') IS NOT NULL THEN
    -- Only create org-based policies when the table contains an 'org_id' column
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'threads' AND column_name = 'org_id'
    ) THEN
      DROP POLICY IF EXISTS threads_select_policy ON public.threads;
      CREATE POLICY threads_select_policy
        ON public.threads FOR SELECT TO authenticated
        USING (exists (select 1 from public.org_members m where m.org_id = threads.org_id and m.user_id = auth.uid()));

      DROP POLICY IF EXISTS threads_insert_policy ON public.threads;
      CREATE POLICY threads_insert_policy
        ON public.threads FOR INSERT TO authenticated
        WITH CHECK (exists (select 1 from public.org_members m where m.org_id = threads.org_id and m.user_id = auth.uid()));

      DROP POLICY IF EXISTS threads_update_policy ON public.threads;
      CREATE POLICY threads_update_policy
        ON public.threads FOR UPDATE TO authenticated
        USING (exists (select 1 from public.org_members m where m.org_id = threads.org_id and m.user_id = auth.uid()));

      DROP POLICY IF EXISTS threads_delete_policy ON public.threads;
      CREATE POLICY threads_delete_policy
        ON public.threads FOR DELETE TO authenticated
        USING (exists (select 1 from public.org_members m where m.org_id = threads.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
    ELSE
      RAISE NOTICE 'Skipping threads policies: column public.threads.org_id not found';
    END IF;
  END IF;
END;
$$;

-- Profiles (perfiles) - allow users to view/edit their own profile
DO $$
BEGIN
  IF to_regclass('public.perfiles') IS NOT NULL THEN
    -- Only create policies when the 'user_id' column exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'perfiles' AND column_name = 'user_id'
    ) THEN
      DROP POLICY IF EXISTS perfiles_view_own ON public.perfiles;
      CREATE POLICY perfiles_view_own
        ON public.perfiles FOR SELECT TO authenticated
        USING (user_id = auth.uid());

      DROP POLICY IF EXISTS perfiles_update_own ON public.perfiles;
      CREATE POLICY perfiles_update_own
        ON public.perfiles FOR UPDATE TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
    ELSE
      RAISE NOTICE 'Skipping perfiles policies: column public.perfiles.user_id not found';
    END IF;
  END IF;
END;
$$;

-- Photos / bitacora (fotos_bitacora)
DO $$
BEGIN
  IF to_regclass('public.fotos_bitacora') IS NOT NULL THEN
    -- Only create org-based policies when the table contains an 'org_id' column
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'fotos_bitacora' AND column_name = 'org_id'
    ) THEN
      DROP POLICY IF EXISTS fotos_bitacora_select ON public.fotos_bitacora;
      CREATE POLICY fotos_bitacora_select
        ON public.fotos_bitacora FOR SELECT TO authenticated
        USING (exists (select 1 from public.org_members m where m.org_id = fotos_bitacora.org_id and m.user_id = auth.uid()));

      DROP POLICY IF EXISTS fotos_bitacora_manage ON public.fotos_bitacora;
      CREATE POLICY fotos_bitacora_manage
        ON public.fotos_bitacora FOR ALL TO authenticated
        USING (exists (select 1 from public.org_members m where m.org_id = fotos_bitacora.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')))
        WITH CHECK (exists (select 1 from public.org_members m where m.org_id = fotos_bitacora.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
    ELSE
      RAISE NOTICE 'Skipping fotos_bitacora policies: column public.fotos_bitacora.org_id not found';
    END IF;
  END IF;
END;
$$;

-- Material catalog / prices
DO $$
BEGIN
  IF to_regclass('public.material_catalog_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS material_catalog_items_select ON public.material_catalog_items;
    CREATE POLICY material_catalog_items_select
      ON public.material_catalog_items FOR SELECT TO authenticated
      USING (true); -- public catalog may be readable by anyone authenticated

    DROP POLICY IF EXISTS material_catalog_items_write ON public.material_catalog_items;
    CREATE POLICY material_catalog_items_write
      ON public.material_catalog_items FOR ALL TO authenticated
      USING (exists (select 1 from public.org_members m where m.org_id = material_catalog_items.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')))
      WITH CHECK (exists (select 1 from public.org_members m where m.org_id = material_catalog_items.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
  END IF;

  IF to_regclass('public.material_price_quotes') IS NOT NULL THEN
    DROP POLICY IF EXISTS material_price_quotes_select ON public.material_price_quotes;
    CREATE POLICY material_price_quotes_select
      ON public.material_price_quotes FOR SELECT TO authenticated
      USING (exists (select 1 from public.org_members m where m.org_id = material_price_quotes.org_id and m.user_id = auth.uid()));

    DROP POLICY IF EXISTS material_price_quotes_write ON public.material_price_quotes;
    CREATE POLICY material_price_quotes_write
      ON public.material_price_quotes FOR ALL TO authenticated
      USING (exists (select 1 from public.org_members m where m.org_id = material_price_quotes.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')))
      WITH CHECK (exists (select 1 from public.org_members m where m.org_id = material_price_quotes.org_id and m.user_id = auth.uid() and m.role in ('owner','admin')));
  END IF;
END;
$$;

-- Allow public read for 'proyectos' table if present (legacy spanish table)
DO $$
BEGIN
  IF to_regclass('public.proyectos') IS NOT NULL THEN
    DROP POLICY IF EXISTS proyectos_public_read ON public.proyectos;
    CREATE POLICY proyectos_public_read
      ON public.proyectos FOR SELECT TO public
      USING (true);
  END IF;
END;
$$;

-- Worker-specific: allow trabajadores to read own profile (if table exists)
DO $$
BEGIN
  IF to_regclass('public.trabajadores') IS NOT NULL THEN
    -- Only create policies when the 'user_id' column exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'trabajadores' AND column_name = 'user_id'
    ) THEN
      DROP POLICY IF EXISTS trabajadores_view_own ON public.trabajadores;
      CREATE POLICY trabajadores_view_own
        ON public.trabajadores FOR SELECT TO authenticated
        USING (user_id = auth.uid());
    ELSE
      RAISE NOTICE 'Skipping trabajadores policies: column public.trabajadores.user_id not found';
    END IF;
  END IF;
END;
$$;

-- Ensure Realtime publication contains core and extra tables (idempotent)
DO $$
DECLARE
  v_pubname text := 'supabase_realtime';
  tables text[] := array[
    'public.projects', 'public.transactions', 'public.budgets', 'public.budget_lines', 'public.budget_line_materials',
    'public.suppliers', 'public.requisitions', 'public.requisition_items', 'public.employees', 'public.employee_contracts',
    'public.org_pay_rates', 'public.employee_rate_overrides', 'public.service_quotes', 'public.project_progress', 'public.project_progress_lines',
    'public.attendance', 'public.employee_attendance_tokens', 'public.project_phases', 'public.audit_logs', 'public.apu_templates',
    'public.messages', 'public.threads', 'public.material_catalog_items', 'public.material_price_quotes', 'public.proyectos'
  ];
  fq text;
  sname text;
  tname text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pg_publication.pubname = v_pubname) THEN
    RAISE NOTICE 'Publication % not found. Enable Realtime in Supabase Dashboard first.', v_pubname;
    RETURN;
  END IF;

  FOREACH fq IN ARRAY tables LOOP
    sname := split_part(fq, '.', 1);
    tname := split_part(fq, '.', 2);
    IF to_regclass(fq) IS NULL THEN
      RAISE NOTICE 'Table not found, skipping: %', fq;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables WHERE pg_publication_tables.pubname = v_pubname AND pg_publication_tables.schemaname = sname AND pg_publication_tables.tablename = tname
    ) THEN
      EXECUTE format('ALTER PUBLICATION %I ADD TABLE %s', v_pubname, fq);
      RAISE NOTICE 'Added % to publication %', fq, v_pubname;
    END IF;
  END LOOP;
END;
$$;

-- Verification hints:
-- SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY schemaname, tablename;
-- SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;