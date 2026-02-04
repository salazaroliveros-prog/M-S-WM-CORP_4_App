import { describe, expect, it } from 'vitest';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { createTransaction } from '../../lib/db';
import { setupOrgAndProject } from './_helpers';

describe('Dashboard: transactions write/read (integration)', () => {
  it('creates a transaction and verifies it exists in Supabase', async () => {
    const ctx = await setupOrgAndProject('VITEST_DASHBOARD_PROJECT');
    if (!ctx) return;

    const { orgId, projectId } = ctx;
    const supabase = getSupabaseClient();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const description = `VITEST_TX_${stamp}`;

    try {
      await createTransaction(orgId, {
        id: crypto.randomUUID(),
        projectId,
        type: 'GASTO',
        description,
        amount: 100,
        unit: 'UND',
        cost: 100,
        category: 'VITEST',
        date: new Date().toISOString(),
        provider: 'VITEST',
      });

      const res = await supabase
        .from('transactions')
        .select('id, description, org_id')
        .eq('org_id', orgId)
        .eq('description', description)
        .limit(5);

      if (res.error) throw res.error;
      expect((res.data ?? []).length).toBeGreaterThan(0);
    } finally {
      // Cleanup transaction
      try {
        await supabase.from('transactions').delete().eq('org_id', orgId).eq('description', description);
      } catch {}

      await ctx.cleanup();
    }
  });
});
