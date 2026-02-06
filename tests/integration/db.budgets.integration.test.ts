import { describe, expect, it } from 'vitest';
import { loadBudgetForProject, saveBudgetForProject } from '../../lib/db';
import { cleanupBudget, setupOrgAndProject } from './_helpers';

describe('Presupuestos: budgets CRUD via lib/db (integration)', () => {
  it('saves and loads budget lines + materials', async () => {
    const ctx = await setupOrgAndProject('VITEST_BUDGET_PROJECT');
    if (!ctx) return;

    const { orgId, projectId } = ctx;

    try {
      const lines = [
        {
          id: crypto.randomUUID(),
          projectId,
          name: 'Excavación',
          unit: 'm3',
          quantity: 10,
          directCost: 0,
          laborCost: 100,
          equipmentCost: 50,
          materials: [
            { name: 'Combustible', unit: 'gal', quantityPerUnit: 2, unitPrice: 25 },
          ],
        },
        {
          id: crypto.randomUUID(),
          projectId,
          name: 'Concreto',
          unit: 'm3',
          quantity: 5,
          directCost: 0,
          laborCost: 200,
          equipmentCost: 0,
          materials: [
            { name: 'Cemento', unit: 'saco', quantityPerUnit: 9, unitPrice: 70 },
            { name: 'Arena', unit: 'm3', quantityPerUnit: 0.5, unitPrice: 210 },
          ],
        },
      ];

      await saveBudgetForProject(orgId, projectId, 'RESIDENCIAL', '35', lines as any);

      const loaded = await loadBudgetForProject(orgId, projectId);
      expect(loaded).toBeTruthy();
      expect(String(loaded!.typology)).toBe('RESIDENCIAL');
      expect(String(loaded!.indirectPct)).toBe('35');
      expect(loaded!.lines.length).toBeGreaterThanOrEqual(2);

      const hasConcreto = loaded!.lines.some((l) => String(l.name).toLowerCase().includes('concreto'));
      expect(hasConcreto).toBe(true);

      const anyMats = loaded!.lines.some((l) => Array.isArray(l.materials) && l.materials.length > 0);
      expect(anyMats).toBe(true);
    } finally {
      try {
        await cleanupBudget(orgId, projectId);
      } catch {}
      await ctx.cleanup();
    }
  });
});
