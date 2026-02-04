import { describe, expect, it } from 'vitest';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { createRequisition, listRequisitions } from '../../lib/db';
import { setupOrgAndProject } from './_helpers';

describe('Compras: requisitions CRUD via lib/db (integration)', () => {
  it('creates and lists requisitions', async () => {
    const ctx = await setupOrgAndProject('VITEST_REQUISITION_PROJECT');
    if (!ctx) return;

    const { orgId, projectId } = ctx;
    const supabase = getSupabaseClient();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const supplierName = `VITEST_SUPP_${stamp}`;

    try {
      await createRequisition(
        orgId,
        projectId,
        supplierName,
        null,
        [
          { name: 'Cemento', unit: 'saco', quantity: 10 },
          { name: 'Arena', unit: 'm3', quantity: 2 },
        ],
        'sent'
      );

      const list = await listRequisitions(orgId);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);

      // We can't reliably filter by supplier in the view, but the list should include our recent requisition.
      const maybeFound = list.some((r) => (r.supplierNote || '').includes(supplierName) || (r.supplierName || '').includes(supplierName));
      expect(maybeFound).toBe(true);
    } finally {
      // Cleanup requisitions created by this run
      try {
        const reqs = await supabase
          .from('requisitions')
          .select('id')
          .eq('org_id', orgId)
          .ilike('notes', `%${supplierName}%`);

        if (!reqs.error) {
          const ids = (reqs.data ?? []).map((r: any) => String(r.id));
          if (ids.length > 0) {
            await supabase.from('requisition_items').delete().eq('org_id', orgId).in('requisition_id', ids);
            await supabase.from('requisitions').delete().eq('org_id', orgId).in('id', ids);
          }
        }
      } catch {}

      // Cleanup supplier row if created
      try {
        await supabase.from('suppliers').delete().eq('org_id', orgId).eq('name', supplierName);
      } catch {}

      await ctx.cleanup();
    }
  });
});
