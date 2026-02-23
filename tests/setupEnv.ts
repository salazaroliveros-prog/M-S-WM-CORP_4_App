import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const cwd = process.cwd();

const candidates = ['.env.local', '.env'];
for (const file of candidates) {
  const p = path.join(cwd, file);
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

// Allow non-Vite env naming in CI/terminals (keeps app convention as VITE_*).
if (!process.env.VITE_SUPABASE_URL && process.env.SUPABASE_URL) {
  process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL;
}
if (!process.env.VITE_SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY) {
  process.env.VITE_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
}

// In CI we want deterministic coverage: if Realtime/auth isn't configured,
// fail loudly instead of silently skipping the checks.
const isCI = String(process.env.CI || '').trim().toLowerCase() === 'true' || Boolean(process.env.GITHUB_ACTIONS);
if (isCI && !process.env.SUPABASE_REQUIRE_REALTIME) {
  process.env.SUPABASE_REQUIRE_REALTIME = 'true';
}
