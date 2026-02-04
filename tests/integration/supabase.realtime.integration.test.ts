import { describe, expect, it } from 'vitest';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { setupOrgAndProject } from './_helpers';

function envBool(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

describe('Supabase Realtime (integration)', () => {
  it('receives postgres_changes for a transaction insert (optional)', async () => {
    const ctx = await setupOrgAndProject('VITEST_REALTIME_PROJECT');
    if (!ctx) return;

    const { orgId, projectId } = ctx;
    const supabase = getSupabaseClient();

    const stamp = nowStamp();
    const description = `VITEST_REALTIME_${stamp}`;

    const requireRealtime = envBool('SUPABASE_REQUIRE_REALTIME');

    const received = new Promise<any>((resolve) => {
      const channel = supabase
        .channel(`vitest-realtime-${stamp}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'transactions',
            filter: `org_id=eq.${orgId}`,
          },
          (payload) => resolve(payload)
        );

      channel.subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;

        // Insert only after we are subscribed.
        await supabase.from('transactions').insert({
          org_id: orgId,
          project_id: projectId,
          type: 'GASTO',
          description,
          amount: 1,
          unit: 'Quetzal',
          cost: 1,
          category: 'VITEST',
          occurred_at: new Date().toISOString(),
        });
      });
    });

    let payload: any | null = null;
    try {
      payload = await Promise.race([
        received,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);

      if (!payload) {
        const msg =
          "Realtime event not received. If you want realtime updates, enable Realtime replication for public.transactions in Supabase Dashboard (Database → Replication → Realtime).";
        if (requireRealtime) throw new Error(msg);
        // eslint-disable-next-line no-console
        console.warn(msg);
        return;
      }

      expect(payload.eventType).toBe('INSERT');
      expect(String(payload.new?.org_id ?? '')).toBe(orgId);
      expect(String(payload.new?.description ?? '')).toBe(description);
    } finally {
      try {
        await supabase.from('transactions').delete().eq('org_id', orgId).eq('project_id', projectId).eq('description', description);
      } catch {}

      await ctx.cleanup();
    }
  });
});
