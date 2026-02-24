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

const stamp = new Date().toISOString();
console.log('Listener starting for orgId=', orgId);

const channel = client
  .channel(`manual-realtime-listener-${Date.now()}`)
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'transactions', filter: `org_id=eq.${orgId}` },
    (payload) => {
      console.log('Realtime event received:', JSON.stringify(payload, null, 2));
      process.exit(0);
    }
  )
  .subscribe((status) => {
    console.log('Channel status:', status);
    if (status === 'SUBSCRIBED') {
      console.log('Subscribed — waiting for insert...');
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.error('Channel error/status:', status);
      process.exit(3);
    }
  });

// safety timeout
setTimeout(() => {
  console.error('Timeout waiting for realtime event (15s)');
  process.exit(4);
}, 15000);
