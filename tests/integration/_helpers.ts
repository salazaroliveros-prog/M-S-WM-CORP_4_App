import { getSupabaseClient } from '../../lib/supabaseClient';
import {
  createProject,
  deleteProject,
  getOrCreateOrgId,
} from '../../lib/db';

export type IntegrationContext = {
  orgId: string;
  projectId: string;
  cleanup: () => Promise<void>;
};

export function isAnonDisabledError(e: any): boolean {
  const msg = String(e?.message || e);
  return msg.toLowerCase().includes('anonymous sign-ins are disabled');
}

export function isRateLimitError(e: any): boolean {
  const msg = String(e?.message || e);
  return msg.toLowerCase().includes('rate limit');
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

let didAuth = false;

async function ensureTestSession(): Promise<void> {
  const supabase = getSupabaseClient();

  // If we already authenticated in this process, don't spam Auth endpoints.
  if (didAuth) {
    const session = await supabase.auth.getSession();
    if (session.data.session) return;
    didAuth = false;
  }

  const email = env('SUPABASE_TEST_EMAIL');
  const password = env('SUPABASE_TEST_PASSWORD');

  if (email && password) {
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    didAuth = true;
    return;
  }

  // Fallback: anonymous sign-in (may be disabled / rate-limited on some projects)
  const anon = await supabase.auth.signInAnonymously();
  if (anon.error) throw anon.error;
  didAuth = true;
}

export function isSchemaMissingError(e: any): boolean {
  const msg = String(e?.message || e);
  return msg.includes("Could not find the table") && msg.toLowerCase().includes('schema cache');
}

export async function ensureAuthOrSkip(): Promise<boolean> {
  try {
    await ensureTestSession();
    return true;
  } catch (e: any) {
    if (isAnonDisabledError(e)) {
      // eslint-disable-next-line no-console
      console.warn('Skipping: Anonymous sign-ins are disabled in Supabase Auth.');
      return false;
    }
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes('invalid login credentials')) {
      throw new Error(
        'SUPABASE_TEST_EMAIL/SUPABASE_TEST_PASSWORD inválidos. Cree un usuario de prueba en Supabase Auth o corrija las credenciales.'
      );
    }
    if (isRateLimitError(e)) {
      // eslint-disable-next-line no-console
      console.warn('Skipping: Supabase Auth rate limit reached. Try again in a minute, or run tests serially.');
      return false;
    }
    throw e;
  }
}

export async function setupOrgAndProject(namePrefix: string): Promise<IntegrationContext | null> {
  const ok = await ensureAuthOrSkip();
  if (!ok) return null;

  let orgId: string;
  let project: { id: string };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  try {
    orgId = await getOrCreateOrgId();
    project = await createProject(orgId, {
      name: `${namePrefix}_${stamp}`,
      clientName: 'VITEST',
      location: 'TEST',
      areaLand: 1,
      areaBuild: 1,
      status: 'standby',
      typology: 'RESIDENCIAL',
      projectManager: 'VITEST',
    });
  } catch (e: any) {
    if (isSchemaMissingError(e)) {
      // eslint-disable-next-line no-console
      console.warn(
        "Skipping: Supabase schema not initialized (missing tables like 'org_members'). Apply migrations in supabase/migrations (start with 20260204_init.sql) and re-run tests."
      );
      return null;
    }
    throw e;
  }

  const supabase = getSupabaseClient();

  const cleanup = async () => {
    // Best-effort cleanup, ignore errors.
    try {
      await deleteProject(orgId, project.id);
    } catch {}

    // Also clean up any suppliers created by tests.
    try {
      await supabase.from('suppliers').delete().eq('org_id', orgId).ilike('name', 'VITEST_SUPP_%');
    } catch {}
  };

  return {
    orgId,
    projectId: project.id,
    cleanup,
  };
}

export async function cleanupBudget(orgId: string, projectId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const budget = await supabase
    .from('budgets')
    .select('id')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (budget.error) throw budget.error;
  if (!budget.data?.id) return;

  const budgetId = String(budget.data.id);

  const lines = await supabase
    .from('budget_lines')
    .select('id')
    .eq('org_id', orgId)
    .eq('budget_id', budgetId);

  if (lines.error) throw lines.error;
  const lineIds = (lines.data ?? []).map((r: any) => String(r.id));

  if (lineIds.length > 0) {
    const delMats = await supabase
      .from('budget_line_materials')
      .delete()
      .eq('org_id', orgId)
      .in('budget_line_id', lineIds);
    if (delMats.error) throw delMats.error;
  }

  const delLines = await supabase
    .from('budget_lines')
    .delete()
    .eq('org_id', orgId)
    .eq('budget_id', budgetId);
  if (delLines.error) throw delLines.error;

  const delBudget = await supabase
    .from('budgets')
    .delete()
    .eq('org_id', orgId)
    .eq('id', budgetId);
  if (delBudget.error) throw delBudget.error;
}

export async function cleanupProgress(orgId: string, projectId: string): Promise<void> {
  const supabase = getSupabaseClient();

  const header = await supabase
    .from('project_progress')
    .select('id')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (header.error) throw header.error;
  if (!header.data?.id) return;

  const progressId = String(header.data.id);

  const delLines = await supabase
    .from('project_progress_lines')
    .delete()
    .eq('org_id', orgId)
    .eq('progress_id', progressId);
  if (delLines.error) throw delLines.error;

  const delHeader = await supabase
    .from('project_progress')
    .delete()
    .eq('org_id', orgId)
    .eq('id', progressId);
  if (delHeader.error) throw delHeader.error;
}
