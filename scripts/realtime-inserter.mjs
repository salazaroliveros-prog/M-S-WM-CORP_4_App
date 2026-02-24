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

async function run() {
  try {
    // find or create a project for the org
    let projectId = null;
    const p = await client.from('projects').select('id').eq('org_id', orgId).limit(1).maybeSingle();
    if (p.error) {
      console.error('Error reading projects:', p.error);
      process.exit(3);
    }
    if (p.data && p.data.id) projectId = p.data.id;

    if (!projectId) {
      const create = await client.from('projects').insert({ org_id: orgId, name: 'ManualRealtimeTest' }).select('id').single();
      if (create.error) {
        console.error('Error creating project:', create.error);
        process.exit(4);
      }
      projectId = create.data.id;
    }

    const description = `manual-realtime-test ${new Date().toISOString()}`;
    const ins = await client.from('transactions').insert({
      org_id: orgId,
      project_id: projectId,
      type: 'GASTO',
      description,
      amount: 1,
      unit: 'QUETZAL',
      cost: 1,
      category: 'MANUAL_TEST',
      occurred_at: new Date().toISOString(),
    });

    if (ins.error) {
      console.error('Insert error:', ins.error);
      process.exit(5);
    }

    console.log('Insert succeeded:', JSON.stringify(ins.data, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Unexpected error:', e);
    process.exit(6);
  }
}

run();
