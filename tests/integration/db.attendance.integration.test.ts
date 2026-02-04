import { describe, expect, it } from 'vitest';
import { getSupabaseClient } from '../../lib/supabaseClient';
import {
  createEmployee,
  getAttendanceTokenInfo,
  listAttendanceForDate,
  setEmployeeAttendanceToken,
  submitAttendanceWithToken,
} from '../../lib/db';
import { setupOrgAndProject } from './_helpers';

describe('Asistencia: token + check-in CRUD via lib/db (integration)', () => {
  it('sets token, resolves token info, submits attendance, and lists daily view', async () => {
    const ctx = await setupOrgAndProject('VITEST_ATTENDANCE_PROJECT');
    if (!ctx) return;

    const { orgId, projectId } = ctx;
    const supabase = getSupabaseClient();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const employeeName = `VITEST_ATT_${stamp}`;
    const token = `VITEST_TOKEN_${stamp}`;

    const workDate = new Date().toISOString().slice(0, 10);

    let employeeId: string | null = null;

    try {
      const emp = await createEmployee(orgId, {
        name: employeeName,
        position: 'Albañil',
        dailyRate: 100,
        projectId,
      });
      employeeId = String(emp.id);

      try {
        await setEmployeeAttendanceToken(employeeId, token);
      } catch (e: any) {
        const msg = String(e?.message || e);
        const lowered = msg.toLowerCase();
        const missingFn = lowered.includes('could not find the function') && lowered.includes('set_employee_attendance_token');
        if (missingFn) {
          // eslint-disable-next-line no-console
          console.warn(
            'Skipping Asistencia integration test: missing public RPC wrappers. Apply supabase/migrations/20260204_attendance_worker_app.sql and supabase/migrations/20260204_attendance_public_rpc_wrappers.sql in Supabase SQL Editor, then retry.'
          );
          return;
        }
        throw e;
      }

      const info = await getAttendanceTokenInfo(token);
      expect(info).toBeTruthy();
      expect(info!.orgId).toBe(orgId);
      expect(info!.employeeId).toBe(employeeId);

      const submitted = await submitAttendanceWithToken({
        token,
        action: 'check_in',
        workDate,
        lat: 14.64072,
        lng: -90.51327,
        accuracyM: 10,
        biometric: { method: 'code', code: '1234' },
        device: { ua: 'vitest' },
      });
      expect(submitted).toBeDefined();

      const rows = await listAttendanceForDate(orgId, workDate);
      expect(Array.isArray(rows)).toBe(true);
      const found = rows.some((r: any) => String(r.employee_id ?? r.employeeId) === employeeId);
      expect(found).toBe(true);
    } finally {
      // Cleanup attendance + token + employee
      try {
        if (employeeId) {
          await supabase
            .from('attendance')
            .delete()
            .eq('org_id', orgId)
            .eq('employee_id', employeeId)
            .eq('work_date', workDate);

          await supabase
            .from('employee_attendance_tokens')
            .delete()
            .eq('org_id', orgId)
            .eq('employee_id', employeeId);

          await supabase
            .from('employees')
            .delete()
            .eq('org_id', orgId)
            .eq('id', employeeId);
        }
      } catch {}

      await ctx.cleanup();
    }
  });
});
