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

    const realtimeHelpMsg =
      "Realtime event not received. If you want realtime updates, enable Realtime replication for public.transactions in Supabase Dashboard (Database → Replication → Realtime).";

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const received = new Promise<any>((resolve, reject) => {
      channel = supabase
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
        if (status === 'SUBSCRIBED') {
          // Insert only after we are subscribed.
          const ins = await supabase.from('transactions').insert({
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
          if (ins.error) reject(ins.error);
          return;
        }

        // These statuses usually mean the channel won't receive anything.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(realtimeHelpMsg));
        }
      });
    });

    let payload: any | null = null;
    try {
      try {
        payload = await Promise.race([
          received,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
      } catch (e: any) {
        if (requireRealtime) throw e;
        // eslint-disable-next-line no-console
        console.warn(String(e?.message || e));
        return;
      }

      if (!payload) {
        if (requireRealtime) throw new Error(realtimeHelpMsg);
        // eslint-disable-next-line no-console
        console.warn(realtimeHelpMsg);
        return;
      }

      expect(payload.eventType).toBe('INSERT');
      expect(String(payload.new?.org_id ?? '')).toBe(orgId);
      expect(String(payload.new?.description ?? '')).toBe(description);
    } finally {
      try {
        await supabase.from('transactions').delete().eq('org_id', orgId).eq('project_id', projectId).eq('description', description);
      } catch {}

      try {
        if (channel) await supabase.removeChannel(channel);
      } catch {}

      await ctx.cleanup();
    }
  });
});
