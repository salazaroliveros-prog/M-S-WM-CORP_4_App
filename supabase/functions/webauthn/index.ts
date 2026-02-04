// @ts-nocheck

import { createClient } from 'npm:@supabase/supabase-js@2.94.0';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@10.0.0';

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function cors(origin: string | null) {
  const headers: Record<string, string> = {
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-origin': origin ?? '*',
    'access-control-max-age': '86400',
  };
  return headers;
}

function hostnameFromOrigin(origin: string) {
  try {
    return new URL(origin).hostname;
  } catch {
    return '';
  }
}

async function sha256Hex(text: string) {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes: Uint8Array) {
  // btoa expects binary string
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function normalizeAction(input: unknown): string {
  const s = String(input ?? '').trim();
  return s;
}

type TokenInfo = { org_id: string; employee_id: string; employee_name: string };

async function getTokenInfo(supabaseAdmin: any, token: string): Promise<TokenInfo | null> {
  const tokenHash = await sha256Hex(token);
  const { data, error } = await supabaseAdmin
    .from('employee_attendance_tokens')
    .select('org_id, employee_id, employees(name)')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .limit(1);

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.org_id || !row?.employee_id) return null;
  return {
    org_id: String(row.org_id),
    employee_id: String(row.employee_id),
    employee_name: String(row.employees?.name ?? ''),
  };
}

async function storeChallenge(supabaseAdmin: any, input: { orgId: string; employeeId: string; tokenHash: string; kind: 'registration' | 'authentication'; challenge: string }) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin.from('webauthn_challenges').insert({
    org_id: input.orgId,
    employee_id: input.employeeId,
    token_hash: input.tokenHash,
    kind: input.kind,
    challenge: input.challenge,
    expires_at: expiresAt,
  });
  if (error) throw error;
}

async function loadLatestChallenge(supabaseAdmin: any, input: { orgId: string; employeeId: string; tokenHash: string; kind: 'registration' | 'authentication' }) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('webauthn_challenges')
    .select('challenge, expires_at')
    .eq('org_id', input.orgId)
    .eq('employee_id', input.employeeId)
    .eq('token_hash', input.tokenHash)
    .eq('kind', input.kind)
    .gte('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row?.challenge ? String(row.challenge) : null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = cors(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405, headers });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, { status: 500, headers });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = normalizeAction(body?.action);
    const token = String(body?.token ?? '').trim();
    if (!token || token.length < 16) {
      return json({ error: 'Token inválido' }, { status: 400, headers });
    }

    const tokenHash = await sha256Hex(token);
    const info = await getTokenInfo(supabaseAdmin, token);
    if (!info) {
      return json({ error: 'Token no válido o desactivado' }, { status: 401, headers });
    }

    const expectedOrigin = origin ?? '';
    const expectedRPID = hostnameFromOrigin(expectedOrigin);
    if (!expectedOrigin || !expectedRPID) {
      return json({ error: 'Origin inválido (se requiere HTTPS y dominio válido)' }, { status: 400, headers });
    }

    // Status
    if (action === 'status') {
      const { data, error } = await supabaseAdmin
        .from('employee_webauthn_credentials')
        .select('id')
        .eq('org_id', info.org_id)
        .eq('employee_id', info.employee_id)
        .eq('is_active', true);

      if (error) throw error;
      return json(
        { employeeName: info.employee_name, credentialCount: (data ?? []).length, rpId: expectedRPID },
        { status: 200, headers }
      );
    }

    // Registration options
    if (action === 'registration_options') {
      const { data, error } = await supabaseAdmin
        .from('employee_webauthn_credentials')
        .select('credential_id, transports')
        .eq('org_id', info.org_id)
        .eq('employee_id', info.employee_id)
        .eq('is_active', true);

      if (error) throw error;

      const excludeCredentials = (data ?? []).map((c: any) => ({
        id: String(c.credential_id),
        type: 'public-key',
        transports: Array.isArray(c.transports) ? c.transports : undefined,
      }));

      const options = await generateRegistrationOptions({
        rpName: 'M&S Construcción',
        rpID: expectedRPID,
        userID: info.employee_id,
        userName: info.employee_name || 'Empleado',
        attestationType: 'none',
        excludeCredentials,
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'preferred',
        },
      });

      await storeChallenge(supabaseAdmin, {
        orgId: info.org_id,
        employeeId: info.employee_id,
        tokenHash,
        kind: 'registration',
        challenge: options.challenge,
      });

      return json({ options, rpId: expectedRPID }, { status: 200, headers });
    }

    // Registration verify
    if (action === 'registration_verify') {
      const expectedChallenge = await loadLatestChallenge(supabaseAdmin, {
        orgId: info.org_id,
        employeeId: info.employee_id,
        tokenHash,
        kind: 'registration',
      });

      if (!expectedChallenge) {
        return json({ error: 'Challenge expirado. Intenta registrar de nuevo.' }, { status: 400, headers });
      }

      const verification = await verifyRegistrationResponse({
        response: body?.response,
        expectedChallenge,
        expectedOrigin,
        expectedRPID,
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return json({ verified: false }, { status: 200, headers });
      }

      const { credential } = verification.registrationInfo;
      const publicKeyB64Url = base64UrlEncode(new Uint8Array(credential.publicKey));
      const transports = credential.transports ?? [];

      const { error } = await supabaseAdmin.from('employee_webauthn_credentials').insert({
        org_id: info.org_id,
        employee_id: info.employee_id,
        credential_id: credential.id,
        public_key: publicKeyB64Url,
        counter: credential.counter,
        transports,
        device_label: body?.deviceLabel ? String(body.deviceLabel) : null,
        is_active: true,
        last_used_at: new Date().toISOString(),
      });

      if (error) throw error;

      return json({ verified: true, credentialId: credential.id }, { status: 200, headers });
    }

    // Authentication options
    if (action === 'authentication_options') {
      const { data, error } = await supabaseAdmin
        .from('employee_webauthn_credentials')
        .select('credential_id, transports')
        .eq('org_id', info.org_id)
        .eq('employee_id', info.employee_id)
        .eq('is_active', true);

      if (error) throw error;
      const allowCredentials = (data ?? []).map((c: any) => ({
        id: String(c.credential_id),
        type: 'public-key',
        transports: Array.isArray(c.transports) ? c.transports : undefined,
      }));

      const options = await generateAuthenticationOptions({
        rpID: expectedRPID,
        userVerification: 'required',
        allowCredentials,
      });

      await storeChallenge(supabaseAdmin, {
        orgId: info.org_id,
        employeeId: info.employee_id,
        tokenHash,
        kind: 'authentication',
        challenge: options.challenge,
      });

      return json({ options, rpId: expectedRPID }, { status: 200, headers });
    }

    // Authentication verify
    if (action === 'authentication_verify') {
      const expectedChallenge = await loadLatestChallenge(supabaseAdmin, {
        orgId: info.org_id,
        employeeId: info.employee_id,
        tokenHash,
        kind: 'authentication',
      });

      if (!expectedChallenge) {
        return json({ error: 'Challenge expirado. Intenta de nuevo.' }, { status: 400, headers });
      }

      const credentialId = String(body?.response?.id ?? body?.response?.rawId ?? '').trim();
      if (!credentialId) {
        return json({ error: 'Respuesta WebAuthn inválida' }, { status: 400, headers });
      }

      const { data, error } = await supabaseAdmin
        .from('employee_webauthn_credentials')
        .select('credential_id, public_key, counter, transports')
        .eq('org_id', info.org_id)
        .eq('employee_id', info.employee_id)
        .eq('credential_id', credentialId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      if (!data) return json({ verified: false }, { status: 200, headers });

      const authenticator = {
        credentialID: credentialId,
        credentialPublicKey: base64UrlDecodeToBytes(String(data.public_key)),
        counter: Number(data.counter ?? 0),
        transports: Array.isArray(data.transports) ? data.transports : undefined,
      };

      const verification = await verifyAuthenticationResponse({
        response: body?.response,
        expectedChallenge,
        expectedOrigin,
        expectedRPID,
        authenticator,
        requireUserVerification: true,
      });

      if (!verification.verified) {
        return json({ verified: false }, { status: 200, headers });
      }

      const newCounter = verification.authenticationInfo?.newCounter ?? authenticator.counter;
      await supabaseAdmin
        .from('employee_webauthn_credentials')
        .update({ counter: newCounter, last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('org_id', info.org_id)
        .eq('employee_id', info.employee_id)
        .eq('credential_id', credentialId);

      return json({ verified: true, credentialId }, { status: 200, headers });
    }

    return json({ error: 'Acción inválida' }, { status: 400, headers });
  } catch (e: any) {
    return json({ error: e?.message || 'Unhandled error' }, { status: 500, headers });
  }
});
