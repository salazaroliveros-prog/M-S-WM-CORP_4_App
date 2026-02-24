import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const orgId = process.env.VITE_ORG_ID || process.env.SUPABASE_ORG_ID || process.env.SUPABASE_TEST_ORG_ID;

if (!url || !anon) {
  console.error('Missing SUPABASE URL or ANON key in env');
  process.exit(2);
}
if (!orgId) {
  console.error('Missing org id in env (VITE_ORG_ID)');
  process.exit(2);
}

const client = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log('Starting selftest for org', orgId);

const stamp = Date.now();
let channel = null;

const received = new Promise((resolve, reject) => {
  channel = client
    .channel(`selftest-${stamp}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'transactions', filter: `org_id=eq.${orgId}` },
      (payload) => resolve(payload)
    )
    .subscribe(async (status) => {
      console.log('Channel status:', status);
      if (status === 'SUBSCRIBED') {
        // find an existing project for this org (do NOT create one to avoid RLS failures)
        const p = await client.from('projects').select('id').eq('org_id', orgId).limit(1).maybeSingle();
        let projectId = null;
        if (p.data && p.data.id) projectId = p.data.id;
        if (!projectId) {
          reject(new Error('No existing project found for org. Create a project in the Supabase dashboard first.'));
          return;
        }

        const description = `selftest_${stamp}`;
        const ins = await client.from('transactions').insert({
          org_id: orgId,
          project_id: projectId,
          type: 'GASTO',
          description,
          amount: 1,
          unit: 'QUETZAL',
          cost: 1,
          category: 'SELFTEST',
          occurred_at: new Date().toISOString(),
        });
        if (ins.error) reject(ins.error);
        console.log('Insert executed, waiting for payload...');
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(new Error('Channel status ' + status));
      }
    });
});

(async () => {
  try {
    const payload = await Promise.race([received, new Promise((r) => setTimeout(() => r(null), 10000))]);
    if (!payload) {
      console.error('No payload received in time');
      process.exit(3);
    }
    console.log('Received payload:', JSON.stringify(payload, null, 2));
    // cleanup
    try { if (channel) await client.removeChannel(channel); } catch {}
    process.exit(0);
  } catch (e) {
    console.error('Error during realtime selftest:', e);
    process.exit(4);
  }
})();
