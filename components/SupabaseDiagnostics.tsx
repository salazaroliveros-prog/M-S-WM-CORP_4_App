import React, { useMemo, useState } from 'react';
import { CheckCircle, XCircle, Loader2, Play, Trash2 } from 'lucide-react';
import type { BudgetLine } from '../types';
import { getSupabaseClient } from '../lib/supabaseClient';
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
  listAuditLogs,
  loadBudgetForProject,
  saveBudgetForProject,
  loadProgressForProject,
  saveProgressForProject,
  createRequisition,
  listRequisitions,
  createEmployee,
  listEmployees,
  upsertEmployeeContract,
  listEmployeeContracts,
  setEmployeeAttendanceToken,
  submitAttendanceWithToken,
  listAttendanceForDate,
} from '../lib/db';

type StepStatus = 'pending' | 'running' | 'ok' | 'fail';

type Step = {
  key: string;
  title: string;
  status: StepStatus;
  detail?: string;
};

function nowStamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-');
}

function safeMsg(e: any) {
  return String(e?.message || e?.error_description || e || 'Error');
}

interface Props {
  orgId: string | null;
  enabled: boolean;
}

const SupabaseDiagnostics: React.FC<Props> = ({ orgId, enabled }) => {
  const [steps, setSteps] = useState<Step[]>([
    { key: 'projects', title: 'Proyectos: crear / listar / actualizar / borrar', status: 'pending' },
    { key: 'realtime', title: 'Realtime: recibe eventos (transactions)', status: 'pending' },
    { key: 'audit', title: 'Auditoría: registra cambios (admin)', status: 'pending' },
    { key: 'budgets', title: 'Presupuestos: guardar / cargar', status: 'pending' },
    { key: 'progress', title: 'Seguimiento: guardar / cargar', status: 'pending' },
    { key: 'compras', title: 'Compras: requisición guardar / listar', status: 'pending' },
    { key: 'rrhh', title: 'RRHH: empleado + contrato guardar / listar', status: 'pending' },
    { key: 'attendance', title: 'Asistencia: token + check-in guardar / listar', status: 'pending' },
    { key: 'cleanup', title: 'Limpieza: borrar datos de prueba', status: 'pending' },
  ]);
  const [running, setRunning] = useState(false);

  const summary = useMemo(() => {
    const ok = steps.filter(s => s.status === 'ok').length;
    const fail = steps.filter(s => s.status === 'fail').length;
    const done = ok + fail;
    return { ok, fail, done, total: steps.length };
  }, [steps]);

  const setStep = (key: string, patch: Partial<Step>) => {
    setSteps(prev => prev.map(s => (s.key === key ? { ...s, ...patch } : s)));
  };

  const reset = () => {
    setSteps(prev => prev.map(s => ({ ...s, status: 'pending', detail: undefined })));
  };

  const run = async () => {
    if (!enabled || !orgId) return;
    reset();
    setRunning(true);

    const stamp = nowStamp();
    const supabase = getSupabaseClient();

    let projectId: string | null = null;
    let budgetId: string | null = null;
    let progressProjectId: string | null = null;
    let requisitionId: string | null = null;
    let supplierId: string | null = null;
    let employeeId: string | null = null;
    let testTxId: string | null = null;
    const contractRequestId = crypto.randomUUID();
    const attendanceToken = `SMOKE_TOKEN_${stamp}`;
    const workDate = new Date().toISOString().slice(0, 10);

    try {
      // 1) Projects
      setStep('projects', { status: 'running' });
      const created = await createProject(orgId, {
        name: `SMOKE_TEST Proyecto ${stamp}`,
        clientName: 'SMOKE_TEST Cliente',
        location: 'SMOKE_TEST Ubicación',
        areaLand: 100,
        areaBuild: 80,
        needs: 'SMOKE_TEST',
        status: 'active',
        startDate: new Date().toISOString(),
        typology: 'RESIDENCIAL',
        projectManager: 'SMOKE_TEST',
      } as any);
      projectId = created.id;

      const listed = await listProjects(orgId);
      if (!listed.some(p => p.id === projectId)) throw new Error('No aparece el proyecto creado en listProjects');

      await updateProject(orgId, projectId, { location: 'SMOKE_TEST Ubicación (edit)' } as any);

      setStep('projects', { status: 'ok', detail: `projectId=${projectId}` });

      // 1.2) Realtime
      setStep('realtime', { status: 'running' });
      try {
        testTxId = crypto.randomUUID();
        const channel = supabase.channel(`diag-realtime:${orgId}:${testTxId}`);

        const waitForInsert = new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            reject(
              new Error(
                'No llegó evento Realtime (timeout). Revise Database → Replication → Realtime (o publicación supabase_realtime) para la tabla transactions.'
              )
            );
          }, 6000);

          channel.on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'transactions', filter: `org_id=eq.${orgId}` },
            (payload: any) => {
              const id = payload?.new?.id ? String(payload.new.id) : '';
              if (id && id === testTxId) {
                window.clearTimeout(timeout);
                resolve();
              }
            }
          );
        });

        const subStatus = await new Promise<string>((resolve) => {
          channel.subscribe((s: any) => resolve(String(s || 'unknown')));
        });

        // Insert a known transaction id (so we can detect it and clean it up)
        await supabase.from('transactions').insert({
          id: testTxId,
          org_id: orgId,
          project_id: projectId,
          type: 'GASTO',
          description: `SMOKE_TEST realtime ${stamp}`,
          amount: 1,
          unit: 'u',
          cost: 1,
          category: 'SMOKE_TEST',
          occurred_at: new Date().toISOString(),
        });

        await waitForInsert;
        setStep('realtime', { status: 'ok', detail: `Evento INSERT recibido (subscribe=${subStatus})` });
        supabase.removeChannel(channel);
      } catch (e: any) {
        setStep('realtime', { status: 'fail', detail: safeMsg(e) });
      }

      // 1.5) Audit logs
      setStep('audit', { status: 'running' });
      try {
        const logs = await listAuditLogs(orgId, { limit: 50, tableName: 'projects' });
        const found = logs.some((l) => String(l.recordId || '') === projectId);
        if (!found) throw new Error('No se encontró auditoría para el proyecto creado/editado');
        setStep('audit', { status: 'ok', detail: `rows=${logs.length}` });
      } catch (e: any) {
        setStep('audit', { status: 'fail', detail: safeMsg(e) });
      }

      // 2) Budgets
      setStep('budgets', { status: 'running' });
      const lines: BudgetLine[] = [
        {
          id: crypto.randomUUID(),
          projectId,
          name: 'SMOKE_TEST Renglón 1',
          unit: 'm2',
          quantity: 10,
          directCost: 0,
          materials: [{ name: 'Cemento', unit: 'bolsa', quantityPerUnit: 0.2, unitPrice: 70 }],
          laborCost: 15,
          equipmentCost: 5,
        },
        {
          id: crypto.randomUUID(),
          projectId,
          name: 'SMOKE_TEST Renglón 2',
          unit: 'm3',
          quantity: 3,
          directCost: 0,
          materials: [{ name: 'Arena', unit: 'm3', quantityPerUnit: 1, unitPrice: 180 }],
          laborCost: 25,
          equipmentCost: 12,
        },
      ];

      await saveBudgetForProject(orgId, projectId, 'RESIDENCIAL', '35', lines);
      const loadedBudget = await loadBudgetForProject(orgId, projectId);
      if (!loadedBudget || (loadedBudget.lines ?? []).length < 2) throw new Error('No se pudo cargar presupuesto guardado');
      setStep('budgets', { status: 'ok', detail: `lines=${loadedBudget.lines.length}` });

      // 3) Progress
      setStep('progress', { status: 'running' });
      await saveProgressForProject(orgId, projectId, {
        projectId,
        lines: [
          { name: 'SMOKE_TEST Renglón 1', unit: 'm2', plannedQty: 10, completedQty: 2, notes: 'OK' },
          { name: 'SMOKE_TEST Renglón 2', unit: 'm3', plannedQty: 3, completedQty: 1, notes: 'OK' },
        ],
      });
      progressProjectId = projectId;
      const loadedProgress = await loadProgressForProject(orgId, projectId);
      if (!loadedProgress || (loadedProgress.lines ?? []).length < 2) throw new Error('No se pudo cargar avance guardado');
      setStep('progress', { status: 'ok', detail: `lines=${loadedProgress.lines.length}` });

      // 4) Compras
      setStep('compras', { status: 'running' });
      const supplierName = `SMOKE_TEST Proveedor ${stamp}`;
      await createRequisition(
        orgId,
        projectId,
        supplierName,
        null,
        [
          { name: 'Clavos', unit: 'caja', quantity: 1 },
          { name: 'Alambre', unit: 'rollo', quantity: 2 },
        ],
        'sent'
      );
      const reqs = await listRequisitions(orgId);
      const smokeReq = reqs.find(r => (r.supplierName || '').toLowerCase().includes(supplierName.toLowerCase()));
      if (!smokeReq) throw new Error('No se encontró la requisición creada en listRequisitions');
      requisitionId = smokeReq.id;
      // Find supplier id for cleanup
      const supplierRow = await supabase
        .from('suppliers')
        .select('id')
        .eq('org_id', orgId)
        .ilike('name', supplierName)
        .order('created_at', { ascending: false })
        .limit(1);
      supplierId = supplierRow.data?.[0]?.id ?? null;
      setStep('compras', { status: 'ok', detail: `requisitionId=${requisitionId}` });

      // 5) RRHH
      setStep('rrhh', { status: 'running' });
      const emp = await createEmployee(orgId, {
        name: `SMOKE_TEST Trabajador ${stamp}`,
        dpi: '0000000000000',
        phone: '00000000',
        position: 'Ayudante',
        dailyRate: 100,
        projectId,
      });
      employeeId = emp.id;
      const emps = await listEmployees(orgId);
      if (!emps.some((e: any) => e.id === employeeId)) throw new Error('Empleado no aparece en listEmployees');

      await upsertEmployeeContract(orgId, {
        requestId: contractRequestId,
        status: 'sent',
        seed: {
          employeeName: emp.name,
          employeePhone: emp.phone,
          role: emp.position,
          dailyRate: 100,
          employeeId,
          projectId,
        },
        employeeId,
        projectId,
      });
      const contracts = await listEmployeeContracts(orgId);
      if (!contracts.some((c: any) => c.request_id === contractRequestId)) throw new Error('Contrato no aparece en listEmployeeContracts');
      setStep('rrhh', { status: 'ok', detail: `employeeId=${employeeId}` });

      // 6) Attendance
      setStep('attendance', { status: 'running' });
      await setEmployeeAttendanceToken(employeeId, attendanceToken);
      await submitAttendanceWithToken({
        token: attendanceToken,
        action: 'check_in',
        workDate,
        lat: 14.6349,
        lng: -90.5069,
        accuracyM: 15,
        biometric: { method: 'code', code: 'SMK123', capturedAt: new Date().toISOString() },
        device: { model: 'SMOKE_TEST', platform: navigator.platform, ua: navigator.userAgent },
      });
      const attendance = await listAttendanceForDate(orgId, workDate);
      if (!attendance.some((a: any) => a.employee_id === employeeId || a.employeeId === employeeId)) {
        throw new Error('Asistencia no aparece en listAttendanceForDate');
      }
      setStep('attendance', { status: 'ok', detail: `workDate=${workDate}` });

      // 7) Cleanup
      setStep('cleanup', { status: 'running' });

      // transactions
      if (testTxId) {
        await supabase.from('transactions').delete().eq('org_id', orgId).eq('id', testTxId);
      }

      // attendance + tokens
      await supabase.from('attendance').delete().eq('org_id', orgId).eq('employee_id', employeeId).eq('work_date', workDate);
      await supabase.from('employee_attendance_tokens').delete().eq('org_id', orgId).eq('employee_id', employeeId);

      // contracts
      await supabase.from('employee_contracts').delete().eq('org_id', orgId).eq('request_id', contractRequestId);

      // requisitions
      if (requisitionId) {
        await supabase.from('requisition_items').delete().eq('org_id', orgId).eq('requisition_id', requisitionId);
        await supabase.from('requisitions').delete().eq('org_id', orgId).eq('id', requisitionId);
      }
      if (supplierId) {
        await supabase.from('suppliers').delete().eq('org_id', orgId).eq('id', supplierId);
      }

      // progress
      if (progressProjectId) {
        const header = await supabase
          .from('project_progress')
          .select('id')
          .eq('org_id', orgId)
          .eq('project_id', progressProjectId)
          .maybeSingle();
        const progressId = header.data?.id ?? null;
        if (progressId) {
          await supabase.from('project_progress_lines').delete().eq('org_id', orgId).eq('progress_id', progressId);
          await supabase.from('project_progress').delete().eq('org_id', orgId).eq('id', progressId);
        }
      }

      // budgets
      const budgetHeader = await supabase
        .from('budgets')
        .select('id')
        .eq('org_id', orgId)
        .eq('project_id', projectId)
        .maybeSingle();
      budgetId = budgetHeader.data?.id ?? null;
      if (budgetId) {
        const lineIds = await supabase
          .from('budget_lines')
          .select('id')
          .eq('org_id', orgId)
          .eq('budget_id', budgetId);
        const ids = (lineIds.data ?? []).map((r: any) => r.id);
        if (ids.length) {
          await supabase.from('budget_line_materials').delete().eq('org_id', orgId).in('budget_line_id', ids);
        }
        await supabase.from('budget_lines').delete().eq('org_id', orgId).eq('budget_id', budgetId);
        await supabase.from('budgets').delete().eq('org_id', orgId).eq('id', budgetId);
      }

      // employees
      if (employeeId) {
        await supabase.from('employees').delete().eq('org_id', orgId).eq('id', employeeId);
      }

      // project
      if (projectId) {
        await deleteProject(orgId, projectId);
      }

      setStep('cleanup', { status: 'ok', detail: 'Datos de prueba eliminados' });
    } catch (e: any) {
      const msg = safeMsg(e);
      const runningKey = steps.find(s => s.status === 'running')?.key;
      if (runningKey) setStep(runningKey, { status: 'fail', detail: msg });
      setStep('cleanup', { status: 'pending' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-bold text-navy-900">Diagnóstico Supabase</h3>
            <div className="text-sm text-gray-600 mt-1">Ejecuta una prueba de lectura/escritura de los módulos principales (con datos temporales que se eliminan al final).</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={run}
              disabled={!enabled || !orgId || running}
              className="px-4 py-2 bg-navy-900 text-white rounded font-bold hover:bg-navy-800 flex items-center gap-2 disabled:opacity-50"
              title="Ejecutar diagnóstico"
            >
              {running ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
              Ejecutar
            </button>
            <button
              onClick={reset}
              disabled={running}
              className="px-4 py-2 bg-white border rounded font-bold hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
              title="Reiniciar"
            >
              <Trash2 size={16} /> Reiniciar
            </button>
          </div>
        </div>

        {!enabled && (
          <div className="mt-4 p-3 rounded border bg-amber-50 border-amber-200 text-amber-800 text-sm">
            Supabase no está configurado en esta app. Configure las variables <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>.
          </div>
        )}

        {enabled && !orgId && (
          <div className="mt-4 p-3 rounded border bg-blue-50 border-blue-200 text-blue-800 text-sm">
            Inicie sesión y espere a que Supabase inicialice la organización.
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 text-sm">
          <div className="font-semibold">Resultado:</div>
          <div className="text-green-700 font-bold">OK {summary.ok}</div>
          <div className="text-red-700 font-bold">Fail {summary.fail}</div>
          <div className="text-gray-600">({summary.done}/{summary.total})</div>
        </div>

        <div className="mt-4 divide-y border rounded">
          {steps.map((s) => (
            <div key={s.key} className="p-3 flex items-start justify-between gap-4">
              <div>
                <div className="font-semibold text-navy-900">{s.title}</div>
                {s.detail && <div className={`text-xs mt-1 ${s.status === 'fail' ? 'text-red-700' : 'text-gray-600'}`}>{s.detail}</div>}
              </div>
              <div className="min-w-[90px] text-right">
                {s.status === 'pending' && <span className="text-gray-400">Pendiente</span>}
                {s.status === 'running' && <span className="text-blue-700 font-bold">Corriendo...</span>}
                {s.status === 'ok' && <span className="text-green-700 font-bold inline-flex items-center gap-1"><CheckCircle size={16} /> OK</span>}
                {s.status === 'fail' && <span className="text-red-700 font-bold inline-flex items-center gap-1"><XCircle size={16} /> Fail</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 text-xs text-gray-500">
          Nota: la prueba crea datos con prefijo <strong>SMOKE_TEST</strong> y luego intenta eliminarlos.
        </div>
      </div>
    </div>
  );
};

export default SupabaseDiagnostics;
