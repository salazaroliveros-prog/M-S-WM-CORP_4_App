import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseMock } from './supabaseMock';

let mockClient: SupabaseMock;

vi.mock('../../lib/supabaseClient', () => {
  return {
    getSupabaseClient: () => mockClient,
  };
});

import {
  // Proyectos
  createProject,
  listProjects,
  updateProject,
  deleteProject,

  // Inicio/Dashboard (transacciones)
  createTransaction,
  listTransactions,
  updateTransaction,

  // Presupuestos
  saveBudgetForProject,
  loadBudgetForProject,

  // Seguimiento
  saveProgressForProject,
  loadProgressForProject,

  // Compras
  createRequisition,
  listRequisitions,
  updateRequisitionStatus,

  // RRHH
  createEmployee,
  listEmployees,
  upsertEmployeeContract,
  listEmployeeContracts,
} from '../../lib/db';

describe('module CRUD smoke (unit, Supabase wiring)', () => {
  beforeEach(() => {
    mockClient = createSupabaseMock();
  });

  it('Proyectos: create/read/update/delete', async () => {
    mockClient = createSupabaseMock({
      from: ({ table, ops }) => {
        if (table === 'projects') {
          const hasOrgEq = ops.some((o) => o.op === 'eq' && o.args[0] === 'org_id' && o.args[1] === 'org1');
          if (ops.some((o) => o.op === 'insert')) {
            const single = ops.some((o) => o.op === 'single');
            if (!single) return { data: null, error: new Error('expected single()') };
            return {
              data: {
                id: 'p1',
                org_id: 'org1',
                name: 'P',
                client_name: 'C',
                location: 'L',
                lot: null,
                block: null,
                coordinates: null,
                area_land: 1,
                area_build: 2,
                needs: '',
                status: 'active',
                start_date: '2026-02-05',
                typology: 'RESIDENCIAL',
                project_manager: 'PM',
              },
              error: null,
            };
          }
          if (ops.some((o) => o.op === 'select') && ops.some((o) => o.op === 'order')) {
            if (!hasOrgEq) return { data: null, error: new Error('expected org_id filter') };
            return { data: [], error: null };
          }
          if (ops.some((o) => o.op === 'update')) {
            const hasIdEq = ops.some((o) => o.op === 'eq' && o.args[0] === 'id' && o.args[1] === 'p1');
            if (!hasOrgEq || !hasIdEq) return { data: null, error: new Error('expected org/id filters') };
            return {
              data: {
                id: 'p1',
                org_id: 'org1',
                name: 'P2',
                client_name: 'C',
                location: 'L',
                lot: null,
                block: null,
                coordinates: null,
                area_land: 1,
                area_build: 2,
                needs: '',
                status: 'active',
                start_date: '2026-02-05',
                typology: 'RESIDENCIAL',
                project_manager: 'PM',
              },
              error: null,
            };
          }
          if (ops.some((o) => o.op === 'delete')) {
            const hasIdEq = ops.some((o) => o.op === 'eq' && o.args[0] === 'id' && o.args[1] === 'p1');
            if (!hasOrgEq || !hasIdEq) return { data: null, error: new Error('expected org/id filters') };
            return { data: null, error: null };
          }
        }
        return { data: null, error: null };
      },
    });

    await createProject('org1', { name: 'P', clientName: 'C', location: 'L', areaLand: 1, areaBuild: 2, typology: 'RESIDENCIAL', projectManager: 'PM', startDate: '2026-02-05', status: 'active', needs: '' });
    await listProjects('org1');
    await updateProject('org1', 'p1', { name: 'P2' });
    await deleteProject('org1', 'p1');

    const fromTables = mockClient.calls.filter((c) => c.type === 'from').map((c) => c.table);
    expect(fromTables).toEqual(expect.arrayContaining(['projects']));
  });

  it('Inicio/Dashboard: write/read/edit transacciones', async () => {
    mockClient = createSupabaseMock({
      from: ({ table, ops }) => {
        if (table !== 'transactions') return { data: null, error: null };

        if (ops.some((o) => o.op === 'insert')) return { data: null, error: null };

        if (ops.some((o) => o.op === 'select') && ops.some((o) => o.op === 'order')) {
          const hasOrgEq = ops.some((o) => o.op === 'eq' && o.args[0] === 'org_id' && o.args[1] === 'org1');
          if (!hasOrgEq) return { data: null, error: new Error('expected org_id filter') };
          return {
            data: [
              {
                id: 't1',
                org_id: 'org1',
                project_id: 'p1',
                type: 'GASTO',
                description: 'x',
                amount: 1,
                unit: 'u',
                cost: 2,
                category: 'c',
                occurred_at: '2026-02-05',
                provider: null,
                rent_end_date: null,
              },
            ],
            error: null,
          };
        }

        if (ops.some((o) => o.op === 'update')) {
          const hasOrgEq = ops.some((o) => o.op === 'eq' && o.args[0] === 'org_id' && o.args[1] === 'org1');
          const hasIdEq = ops.some((o) => o.op === 'eq' && o.args[0] === 'id' && o.args[1] === 't1');
          const hasSingle = ops.some((o) => o.op === 'single');
          if (!hasOrgEq || !hasIdEq || !hasSingle) return { data: null, error: new Error('missing filters') };
          return {
            data: {
              id: 't1',
              org_id: 'org1',
              project_id: 'p1',
              type: 'GASTO',
              description: 'y',
              amount: 1,
              unit: 'u',
              cost: 3,
              category: 'c',
              occurred_at: '2026-02-05',
              provider: null,
              rent_end_date: null,
            },
            error: null,
          };
        }

        return { data: null, error: null };
      },
    });

    await createTransaction('org1', {
      id: 't1',
      projectId: 'p1',
      type: 'GASTO',
      description: 'x',
      amount: 1,
      unit: 'u',
      cost: 2,
      category: 'c',
      date: '2026-02-05',
    });

    const listed = await listTransactions('org1', { projectId: 'p1', limit: 10 });
    expect(listed).toHaveLength(1);

    const updated = await updateTransaction('org1', 't1', { description: 'y', cost: 3 });
    expect(updated.id).toBe('t1');
    expect(updated.cost).toBe(3);
  });

  it('Presupuestos: write/read/edit (save/load presupuesto)', async () => {
    mockClient = createSupabaseMock({
      from: ({ table, ops }) => {
        if (table === 'budgets') {
          if (ops.some((o) => o.op === 'upsert')) {
            const hasSingle = ops.some((o) => o.op === 'single');
            if (!hasSingle) return { data: null, error: new Error('expected single') };
            return { data: { id: 'b1' }, error: null };
          }
          if (ops.some((o) => o.op === 'select') && ops.some((o) => o.op === 'maybeSingle')) {
            return { data: { id: 'b1', indirect_pct: 35, typology: 'RESIDENCIAL' }, error: null };
          }
        }
        if (table === 'budget_lines') {
          if (ops.some((o) => o.op === 'insert')) {
            return { data: [{ id: 'l1', name: 'Linea 1' }], error: null };
          }
          if (ops.some((o) => o.op === 'delete')) return { data: null, error: null };
          if (ops.some((o) => o.op === 'select') && ops.some((o) => o.op === 'order')) {
            // loadBudgetForProject
            return {
              data: [
                {
                  id: 'l1',
                  name: 'Linea 1',
                  unit: 'm2',
                  quantity: 1,
                  direct_cost: 12,
                  labor_cost: 1,
                  equipment_cost: 1,
                  sort_order: 0,
                },
              ],
              error: null,
            };
          }
          // existingLines select (for delete)
          if (ops.some((o) => o.op === 'select')) return { data: [], error: null };
        }
        if (table === 'budget_line_materials') {
          if (ops.some((o) => o.op === 'delete')) return { data: null, error: null };
          if (ops.some((o) => o.op === 'insert')) return { data: null, error: null };
          if (ops.some((o) => o.op === 'select')) {
            return {
              data: [
                {
                  budget_line_id: 'l1',
                  name: 'Cemento',
                  unit: 'saco',
                  quantity_per_unit: 1,
                  unit_price: 10,
                },
              ],
              error: null,
            };
          }
        }
        return { data: null, error: null };
      },
    });

    await saveBudgetForProject('org1', 'p1', 'RESIDENCIAL', '35', [
      {
        id: 'tmp',
        projectId: 'p1',
        name: 'Linea 1',
        unit: 'm2',
        quantity: 1,
        directCost: 0,
        laborCost: 1,
        equipmentCost: 1,
        materials: [{ name: 'Cemento', unit: 'saco', quantityPerUnit: 1, unitPrice: 10 }],
      },
    ]);

    await loadBudgetForProject('org1', 'p1');

    const fromTables = mockClient.calls.filter((c) => c.type === 'from').map((c) => c.table);
    expect(fromTables).toEqual(expect.arrayContaining(['budgets', 'budget_lines', 'budget_line_materials']));
  });

  it('Seguimiento: write/read/edit (save/load avance físico)', async () => {
    mockClient = createSupabaseMock({
      from: ({ table, ops }) => {
        if (table === 'project_progress') {
          if (ops.some((o) => o.op === 'upsert')) {
            const hasSingle = ops.some((o) => o.op === 'single');
            if (!hasSingle) return { data: null, error: new Error('expected single') };
            return { data: { id: 'pp1' }, error: null };
          }
          if (ops.some((o) => o.op === 'select') && ops.some((o) => o.op === 'maybeSingle')) {
            return { data: { id: 'pp1', updated_at: '2026-02-05T00:00:00Z' }, error: null };
          }
        }
        if (table === 'project_progress_lines') {
          if (ops.some((o) => o.op === 'delete')) return { data: null, error: null };
          if (ops.some((o) => o.op === 'insert')) return { data: null, error: null };
          if (ops.some((o) => o.op === 'select')) {
            return {
              data: [
                {
                  line_name: 'Linea 1',
                  unit: 'm2',
                  planned_qty: 10,
                  completed_qty: 5,
                  notes: null,
                },
              ],
              error: null,
            };
          }
        }
        return { data: null, error: null };
      },
    });

    await saveProgressForProject('org1', 'p1', {
      projectId: 'p1',
      updatedAt: '2026-02-05T00:00:00Z',
      lines: [{ name: 'Linea 1', unit: 'm2', plannedQty: 10, completedQty: 5 }],
    });

    const loaded = await loadProgressForProject('org1', 'p1');
    expect(loaded?.lines?.[0]?.name).toBe('Linea 1');

    const fromTables = mockClient.calls.filter((c) => c.type === 'from').map((c) => c.table);
    expect(fromTables).toEqual(expect.arrayContaining(['project_progress', 'project_progress_lines']));
  });

  it('Compras: write/read/edit (create/list/update requisiciones)', async () => {
    mockClient = createSupabaseMock({
      from: ({ table, ops }) => {
        if (table === 'suppliers') {
          // supplierName = null => not called in this test
          return { data: [], error: null };
        }
        if (table === 'requisitions') {
          if (ops.some((o) => o.op === 'insert')) {
            const hasSingle = ops.some((o) => o.op === 'single');
            if (!hasSingle) return { data: null, error: new Error('expected single') };
            return { data: { id: 'r1' }, error: null };
          }
          if (ops.some((o) => o.op === 'update')) return { data: null, error: null };
        }
        if (table === 'requisition_items') {
          if (ops.some((o) => o.op === 'insert')) return { data: null, error: null };
        }
        if (table === 'v_requisition_totals') {
          return {
            data: [
              {
                requisition_id: 'r1',
                project_id: 'p1',
                requested_at: '2026-02-05',
                total_amount: 100,
                actual_total_amount: 0,
                status: 'sent',
                supplier_name: null,
                notes: null,
              },
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      },
    });

    await createRequisition('org1', 'p1', null, null, [{ name: 'Cemento', unit: 'saco', quantity: 1 }], 'sent');
    const list = await listRequisitions('org1');
    expect(list).toHaveLength(1);
    await updateRequisitionStatus('org1', 'r1', 'received');

    const fromTables = mockClient.calls.filter((c) => c.type === 'from').map((c) => c.table);
    expect(fromTables).toEqual(expect.arrayContaining(['requisitions', 'requisition_items', 'v_requisition_totals']));
  });

  it('RRHH: write/read/edit (employees + contracts)', async () => {
    mockClient = createSupabaseMock({
      from: ({ table, ops }) => {
        if (table === 'employees') {
          if (ops.some((o) => o.op === 'insert')) {
            const hasSingle = ops.some((o) => o.op === 'single');
            if (!hasSingle) return { data: null, error: new Error('expected single') };
            return { data: { id: 'e1' }, error: null };
          }
          if (ops.some((o) => o.op === 'select')) return { data: [{ id: 'e1' }], error: null };
        }
        if (table === 'employee_contracts') {
          if (ops.some((o) => o.op === 'upsert')) return { data: null, error: null };
          if (ops.some((o) => o.op === 'select')) return { data: [{ id: 'c1' }], error: null };
        }
        return { data: null, error: null };
      },
    });

    await createEmployee('org1', { name: 'Emp', position: 'Albañil', dailyRate: 100, phone: '', dpi: '' });
    await listEmployees('org1');
    await upsertEmployeeContract('org1', {
      requestId: '00000000-0000-0000-0000-000000000000',
      employeeId: 'e1',
      contractType: 'laboral',
      startDate: '2026-02-05',
      endDate: null,
      baseSalary: 100,
      currency: 'GTQ',
      notes: null,
    });
    await listEmployeeContracts('org1');

    const fromTables = mockClient.calls.filter((c) => c.type === 'from').map((c) => c.table);
    expect(fromTables).toEqual(expect.arrayContaining(['employees', 'employee_contracts']));
  });
});
