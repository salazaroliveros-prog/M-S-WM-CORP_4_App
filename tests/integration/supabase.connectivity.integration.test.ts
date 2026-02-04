import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

describe('Supabase connectivity (integration)', () => {
  const url = env('VITE_SUPABASE_URL');
  const anonKey = env('VITE_SUPABASE_ANON_KEY');
  const testEmail = env('SUPABASE_TEST_EMAIL');
  const testPassword = env('SUPABASE_TEST_PASSWORD');

  const shouldRun = Boolean(url && anonKey);

  if (!shouldRun) {
    // Helps when someone runs `npm run test:supabase` without exporting env vars.
    // (vitest's skipped tests don't show a reason by default)
    // eslint-disable-next-line no-console
    console.warn(
      'Skipping Supabase integration tests: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_URL/SUPABASE_ANON_KEY) in .env.local or terminal env.'
    );
  }

  const maybeIt = shouldRun ? it : it.skip;

  maybeIt('reaches Auth + Rest endpoints', async () => {
    const authHealth = await fetch(`${url}/auth/v1/health`, {
      headers: {
        apikey: anonKey!,
        Authorization: `Bearer ${anonKey!}`,
      },
    });
    expect([200, 204]).toContain(authHealth.status);

    const rest = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: anonKey!,
        Authorization: `Bearer ${anonKey!}`,
      },
    });

    // We only care that the endpoint is reachable.
    // Depending on project settings, this can be 200 (OpenAPI), 401 (unauthorized), or 404.
    expect([200, 401, 404]).toContain(rest.status);
  });

  maybeIt('anonymous sign-in (optional) works when enabled', async () => {
    const client = createClient(url!, anonKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const signIn = await client.auth.signInAnonymously();
    if (signIn.error) {
      const msg = String(signIn.error.message || signIn.error);
      if (msg.toLowerCase().includes('anonymous sign-ins are disabled')) {
        // eslint-disable-next-line no-console
        console.warn('Anonymous sign-ins are disabled in Supabase Auth; skipping anon-auth assertion.');
        return;
      }
      if (msg.toLowerCase().includes('rate limit')) {
        // eslint-disable-next-line no-console
        console.warn('Supabase Auth rate limit reached; skipping anon-auth assertion.');
        return;
      }
      throw signIn.error;
    }

    const session = await client.auth.getSession();
    expect(session.data.session).toBeTruthy();
  });

  maybeIt('password sign-in works when test credentials are configured', async () => {
    if (!testEmail || !testPassword) {
      // eslint-disable-next-line no-console
      console.warn('Skipping password sign-in check: set SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD in .env.local.');
      return;
    }

    const client = createClient(url!, anonKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const signIn = await client.auth.signInWithPassword({ email: testEmail, password: testPassword });
    if (signIn.error) {
      const msg = String(signIn.error.message || signIn.error);
      if (msg.toLowerCase().includes('rate limit')) {
        // eslint-disable-next-line no-console
        console.warn('Supabase Auth rate limit reached; skipping password-auth assertion.');
        return;
      }
      throw signIn.error;
    }

    const session = await client.auth.getSession();
    expect(session.data.session).toBeTruthy();
  });
});
