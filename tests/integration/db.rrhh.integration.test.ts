import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { createEmployee, listEmployees, listEmployeeContracts, upsertEmployeeContract } from '../../lib/db';
import { setupOrgAndProject } from './_helpers';

describe('RRHH: employees + contracts CRUD via lib/db (integration)', () => {
  it('creates an employee and upserts a contract request', async () => {
    const ctx = await setupOrgAndProject('VITEST_RRHH_PROJECT');
    if (!ctx) return;

    const { orgId, projectId } = ctx;
    const supabase = getSupabaseClient();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const employeeName = `VITEST_EMP_${stamp}`;
    const requestId = randomUUID();

    let employeeId: string | null = null;

    try {
      const emp = await createEmployee(orgId, {
        name: employeeName,
        position: 'Albañil',
        dailyRate: 100,
        projectId,
      });
      employeeId = String(emp.id);

      const employees = await listEmployees(orgId);
      expect(employees.some((e: any) => String(e.id) === employeeId)).toBe(true);

      const contract = await upsertEmployeeContract(orgId, {
        requestId,
        status: 'sent',
        employeeId,
        projectId,
        seed: {
          employeeId,
          projectId,
          employeeName,
          role: 'Albañil',
          dailyRate: 100,
          employeePhone: '00000000',
        },
        response: null,
      });

      expect(String(contract.request_id)).toBe(requestId);

      const contracts = await listEmployeeContracts(orgId, 50);
      expect(contracts.some((c: any) => String(c.request_id) === requestId)).toBe(true);
    } finally {
      // Cleanup contract + employee
      try {
        await supabase.from('employee_contracts').delete().eq('org_id', orgId).eq('request_id', requestId);
      } catch {}
      try {
        if (employeeId) {
          await supabase.from('employees').delete().eq('org_id', orgId).eq('id', employeeId);
        }
      } catch {}
      await ctx.cleanup();
    }
  });
});
