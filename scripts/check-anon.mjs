import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function run() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in env');
    process.exit(2);
  }
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const res = await client.auth.signInAnonymously();
    console.log('signInAnonymously result:', JSON.stringify(res, null, 2));
    const sess = await client.auth.getSession();
    console.log('getSession:', JSON.stringify(sess, null, 2));
  } catch (e) {
    console.error('error:', e);
  }
}

run();
