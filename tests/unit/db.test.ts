import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from './supabaseMock';

let mockClient: SupabaseMock;

vi.mock('../../lib/supabaseClient', () => {
  return {
    getSupabaseClient: () => mockClient,
  };
});

import {
  ensureSupabaseSession,
  getOrCreateOrgId,
  listProjects,
  setEmployeeAttendanceToken,
  submitAttendanceWithToken,
  listAttendanceForDate,
  getAttendanceTokenInfo,
  webauthnInvoke,
} from '../../lib/db';

describe('lib/db Supabase wiring (unit)', () => {
  beforeEach(() => {
    mockClient = createSupabaseMock();
  });

  it('ensureSupabaseSession: does nothing if session exists', async () => {
    mockClient = createSupabaseMock({
      getSession: () => ({
        data: {
          session: {
            user: { id: 'u1' },
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      }),
    });

    await expect(ensureSupabaseSession()).resolves.toBeUndefined();

    const callTypes = mockClient.calls.map((c) => c.type);
    expect(callTypes).toContain('auth.getSession');
    expect(callTypes).not.toContain('auth.signInAnonymously');
  });

  it('ensureSupabaseSession: signs in anonymously when no session', async () => {
    let sessionCalls = 0;
    mockClient = createSupabaseMock({
      getSession: () => {
        sessionCalls += 1;
        if (sessionCalls === 1) return { data: { session: null } };
        return {
          data: {
            session: {
              user: { id: 'u1' },
              access_token: 'access',
              refresh_token: 'refresh',
            },
          },
        };
      },
      signInAnonymously: () => ({
        error: null,
        data: { session: { access_token: 'access', refresh_token: 'refresh' } },
      }),
      setSession: () => ({ error: null }),
      getUser: () => ({ data: { user: { id: 'u1' } }, error: null }),
    });

    await expect(ensureSupabaseSession()).resolves.toBeUndefined();

    const callTypes = mockClient.calls.map((c) => c.type);
    expect(callTypes).toContain('auth.getSession');
    expect(callTypes).toContain('auth.signInAnonymously');
  });

  it('getOrCreateOrgId: returns membership org_id if present', async () => {
    mockClient = createSupabaseMock({
      from: ({ table }) => {
        if (table === 'org_members') return { data: [{ org_id: 'org_123', role: 'owner' }], error: null };
        return { data: null, error: null };
      },
    });

    await expect(getOrCreateOrgId('X')).resolves.toBe('org_123');

    const fromCalls = mockClient.calls.filter((c) => c.type === 'from').map((c) => c.table);
    expect(fromCalls).toContain('org_members');
  });

  it('getOrCreateOrgId: creates organization when no memberships', async () => {
    mockClient = createSupabaseMock({
      getSession: () => ({
        data: {
          session: {
            user: { id: 'u1' },
            access_token: 'access',
            refresh_token: 'refresh',
          },
        },
      }),
      from: ({ table, ops }) => {
        if (table === 'org_members') return { data: [], error: null };
        if (table === 'organizations') {
          const insertOp = ops.find((o) => o.op === 'insert');
          if (!insertOp) return { data: null, error: new Error('expected insert') };
          return { data: { id: 'org_new' }, error: null };
        }
        return { data: null, error: null };
      },
    });

    await expect(getOrCreateOrgId('Nueva Org')).resolves.toBe('org_new');

    const fromCalls = mockClient.calls.filter((c) => c.type === 'from').map((c) => c.table);
    expect(fromCalls).toEqual(expect.arrayContaining(['org_members', 'organizations']));
  });

  it('listProjects: queries projects by org_id and maps fields', async () => {
    mockClient = createSupabaseMock({
      from: ({ table, ops }) => {
        if (table !== 'projects') return { data: null, error: null };
        const eqOrg = ops.find((o) => o.op === 'eq' && o.args[0] === 'org_id' && o.args[1] === 'org1');
        const order = ops.find((o) => o.op === 'order' && o.args[0] === 'created_at');
        if (!eqOrg || !order) return { data: null, error: new Error('missing expected filters') };

        return {
          data: [
            {
              id: 'p1',
              org_id: 'org1',
              name: 'Proyecto 1',
              client_name: 'Cliente',
              location: 'Lima',
              lot: null,
              block: null,
              coordinates: null,
              area_land: 10,
              area_build: 20,
              needs: 'N',
              status: 'active',
              start_date: '2026-01-01',
              typology: 'T',
              project_manager: 'PM',
            },
          ],
          error: null,
        };
      },
    });

    const out = await listProjects('org1');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('p1');
    expect(out[0].clientName).toBe('Cliente');
    expect(out[0].areaLand).toBe(10);
  });

  it('Attendance + WebAuthn: uses expected RPC/table/function names', async () => {
    mockClient = createSupabaseMock({
      getSession: () => ({
        data: {
          session: {
            access_token: 'at',
            refresh_token: 'rt',
            user: { id: 'u1' },
          },
        },
      }),
      getUser: () => ({ data: { user: { id: 'u1' } }, error: null }),
      rpc: ({ fn }) => {
        if (fn === 'get_attendance_token_info') {
          return { data: [{ org_id: 'org1', employee_id: 'e1', employee_name: 'Emp' }], error: null };
        }
        return { data: { ok: true }, error: null };
      },
      from: ({ table }) => {
        if (table === 'v_attendance_daily') return { data: [{ employee_id: 'e1' }], error: null };
        return { data: null, error: null };
      },
      invoke: ({ fn }) => {
        if (fn !== 'webauthn') return { data: null, error: new Error('unexpected fn') };
        return { data: { ok: true }, error: null };
      },
    });

    const token = 'tok_123456789012345';
    await expect(setEmployeeAttendanceToken('e1', token)).resolves.toBeUndefined();

    const submitRes = await submitAttendanceWithToken({
      token,
      action: 'check_in',
      lat: 1,
      lng: 2,
      accuracyM: 3,
      biometric: { m: 'x' },
      device: { d: 'y' },
    });
    expect(submitRes).toEqual({ ok: true });

    const rows = await listAttendanceForDate('org1', '2026-02-04');
    expect(rows).toHaveLength(1);

    const info = await getAttendanceTokenInfo(token);
    expect(info).toEqual({ orgId: 'org1', employeeId: 'e1', employeeName: 'Emp' });

    const w = await webauthnInvoke('status', { token });
    expect(w).toEqual({ ok: true });

    const rpcCalls = mockClient.calls.filter((c) => c.type === 'rpc').map((c) => c.fn);
    expect(rpcCalls).toEqual(
      expect.arrayContaining([
        'set_employee_attendance_token',
        'submit_attendance_with_token',
        'get_attendance_token_info',
      ])
    );

    const fromCalls = mockClient.calls.filter((c) => c.type === 'from').map((c) => c.table);
    expect(fromCalls).toContain('v_attendance_daily');

    const invokeCalls = mockClient.calls.filter((c) => c.type === 'invoke').map((c) => c.fn);
    expect(invokeCalls).toContain('webauthn');
  });
});
