// @ts-nocheck

import { createClient } from 'npm:@supabase/supabase-js@2.97.0';
import webpush from 'npm:web-push@3.6.7';

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function cors(origin: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  return headers;
}

function bearerToken(req: Request) {
  const raw = req.headers.get('authorization') ?? '';
  const m = raw.match(/Bearer\s+(.+)/i);
  return m ? m[1].trim() : '';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = cors(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405, headers });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const VAPID_PUBLIC_KEY = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY');
    const VAPID_PRIVATE_KEY = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY');
    const SUBJECT = Deno.env.get('WEB_PUSH_SUBJECT') || 'mailto:admin@example.com';

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, { status: 500, headers });
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json({ error: 'Missing WEB_PUSH_VAPID_PUBLIC_KEY or WEB_PUSH_VAPID_PRIVATE_KEY' }, { status: 500, headers });
    }

    const token = bearerToken(req);
    if (!token) {
      return json({ error: 'Missing Authorization bearer token' }, { status: 401, headers });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Validate caller user
    const userRes = await supabaseAdmin.auth.getUser(token);
    const userId = userRes?.data?.user?.id;
    if (!userId) {
      return json({ error: 'Invalid token' }, { status: 401, headers });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    // Lightweight helper: allow client to fetch the VAPID public key at runtime.
    // Still requires a valid Supabase session token (validated above).
    if (String(body?.action ?? '') === 'publicKey') {
      return json({ ok: true, publicKey: VAPID_PUBLIC_KEY }, { status: 200, headers });
    }

    const orgId = String(body?.orgId ?? '').trim();
    const title = String(body?.title ?? 'Notificación');
    const msgBody = String(body?.body ?? '');
    const data = body?.data ?? {};

    if (!orgId) {
      return json({ error: 'orgId requerido' }, { status: 400, headers });
    }

    // Ensure caller is member of org
    const mem = await supabaseAdmin
      .from('org_members')
      .select('org_id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .limit(1);

    if (mem.error) throw mem.error;
    const isMember = Array.isArray(mem.data) && mem.data.length > 0;
    if (!isMember) {
      return json({ error: 'Forbidden' }, { status: 403, headers });
    }

    const subsRes = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('org_id', orgId);

    if (subsRes.error) throw subsRes.error;

    webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const payload = JSON.stringify({ title, body: msgBody, data });

    const results: any[] = [];
    for (const s of subsRes.data ?? []) {
      const sub = {
        endpoint: String(s.endpoint),
        keys: { p256dh: String(s.p256dh), auth: String(s.auth) },
      };
      try {
        await webpush.sendNotification(sub, payload);
        results.push({ id: s.id, ok: true });
      } catch (e: any) {
        const statusCode = e?.statusCode ?? e?.status ?? null;
        results.push({ id: s.id, ok: false, statusCode, message: e?.message ?? String(e) });
        if (statusCode === 404 || statusCode === 410) {
          try {
            await supabaseAdmin.from('push_subscriptions').delete().eq('id', s.id);
          } catch {
            // ignore
          }
        }
      }
    }

    return json({ ok: true, sent: results.length, results }, { status: 200, headers });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message ?? String(e) }, { status: 500, headers });
  }
});
