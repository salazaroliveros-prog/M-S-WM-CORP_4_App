import { describe, expect, it } from 'vitest';

import {
  createProject,
  deleteProject,
  getOrCreateOrgId,
  listProjects,
} from '../../lib/db';

import { ensureAuthOrSkip } from './_helpers';

function isSchemaMissingError(e: any): boolean {
  const msg = String(e?.message || e);
  return msg.includes("Could not find the table") && msg.toLowerCase().includes('schema cache');
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

describe('Supabase CRUD via lib/db (integration)', () => {
  const url = env('VITE_SUPABASE_URL');
  const anonKey = env('VITE_SUPABASE_ANON_KEY');
  const shouldRun = Boolean(url && anonKey);

  if (!shouldRun) {
    // eslint-disable-next-line no-console
    console.warn(
      'Skipping Supabase CRUD integration test: missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local or terminal env.'
    );
  }

  const maybeIt = shouldRun ? it : it.skip;

  maybeIt('creates, lists, and deletes a project', async () => {
    const ok = await ensureAuthOrSkip();
    if (!ok) return;

    let orgId: string;
    try {
      orgId = await getOrCreateOrgId();
    } catch (e: any) {
      if (isSchemaMissingError(e)) {
        // eslint-disable-next-line no-console
        console.warn(
          "Skipping project CRUD: Supabase schema not initialized (missing tables like 'org_members'). Apply supabase/migrations/20260204_init.sql and related migrations."
        );
        return;
      }
      throw e;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `VITEST_PROJECT_${stamp}`;

    const created = await createProject(orgId, {
      name,
      clientName: 'VITEST',
      location: 'TEST',
      areaLand: 1,
      areaBuild: 1,
      status: 'standby',
      typology: 'RESIDENCIAL',
      projectManager: 'VITEST',
    });

    try {
      expect(created.id).toBeTruthy();
      expect(created.name).toBe(name);

      const projects = await listProjects(orgId);
      expect(projects.some((p) => p.id === created.id || p.name === name)).toBe(true);
    } finally {
      // Best-effort cleanup
      await deleteProject(orgId, created.id);
    }
  });
});
