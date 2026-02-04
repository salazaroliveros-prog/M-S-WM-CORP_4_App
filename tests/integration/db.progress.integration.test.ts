import { describe, expect, it } from 'vitest';
import { loadProgressForProject, saveProgressForProject } from '../../lib/db';
import { cleanupProgress, setupOrgAndProject } from './_helpers';

describe('Seguimiento: progress CRUD via lib/db (integration)', () => {
  it('saves and loads project progress lines', async () => {
    const ctx = await setupOrgAndProject('VITEST_PROGRESS_PROJECT');
    if (!ctx) return;

    const { orgId, projectId } = ctx;

    try {
      await saveProgressForProject(orgId, projectId, {
        projectId,
        lines: [
          { name: 'Excavación', unit: 'm3', plannedQty: 10, completedQty: 3, notes: 'Inicio' },
          { name: 'Concreto', unit: 'm3', plannedQty: 5, completedQty: 0, notes: '' },
        ],
      });

      const loaded = await loadProgressForProject(orgId, projectId);
      expect(loaded).toBeTruthy();
      expect(loaded!.projectId).toBe(projectId);
      expect(loaded!.lines.length).toBe(2);
      expect(loaded!.lines[0].name).toBeTruthy();
    } finally {
      try {
        await cleanupProgress(orgId, projectId);
      } catch {}
      await ctx.cleanup();
    }
  });
});
