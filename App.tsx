import React, { useState, useEffect, useRef } from 'react';
import { LayoutDashboard, Wallet, HardHat, FileText, Activity, ShoppingCart, Users, Calculator, LogOut, Menu, X, Lock } from 'lucide-react';
import { ViewState, Project, RequisitionData, QuoteInitialData } from './types';
import { getSupabaseClient, isSupabaseConfigured } from './lib/supabaseClient';
import {
  ensureSupabaseSession,
  getOrCreateOrgId,
  listProjects,
  createProject as dbCreateProject,
  updateProject as dbUpdateProject,
  deleteProject as dbDeleteProject,
  createTransaction as dbCreateTransaction,
  loadBudgetForProject,
  saveBudgetForProject,
  loadProgressForProject,
  saveProgressForProject,
  importMaterialPricesFromCsvUrl,
  importMaterialPricesFromCsvText,
  suggestLineFromApuCatalog,
  importApuTemplatesFromJsonUrl,
  importApuTemplatesFromCsvUrl,
  importApuTemplatesFromCsvText,
  createRequisition,
  listRequisitions,
  listEmployees,
  createEmployee,
  listRequisitionItems,
  setRequisitionItemsActualUnitCosts,
  updateRequisitionStatus,
  listSuppliers,
  upsertSupplier,
  deleteSupplier,
  listOrgPayRates,
  upsertOrgPayRates,
  listEmployeeRateOverrides,
  upsertEmployeeRateOverride,
  deleteEmployeeRateOverride,
  listEmployeeContracts,
  upsertEmployeeContract,
  listAttendanceForDate,
  setEmployeeAttendanceToken,
  listServiceQuotes,
  upsertServiceQuote,
  deleteServiceQuote,
} from './lib/db';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// Components
import WelcomeScreen from './components/WelcomeScreen';
import Notifications from './components/Notifications';
import Dashboard from './components/Dashboard';
import Inicio from './components/Inicio';
import Proyectos from './components/Proyectos';
import Presupuestos from './components/Presupuestos';
import Seguimiento from './components/Seguimiento';
import Compras from './components/Compras';
import RRHH from './components/RRHH';
import Cotizador from './components/Cotizador';
import WorkerAttendance from './components/WorkerAttendance';
import ContractIntake from './components/ContractIntake';

const LOCAL_PASSWORD_KEY = 'ms_local_admin_password_v1';
const LOCAL_TRANSACTIONS_KEY = 'transactions';
const PENDING_TRANSACTIONS_KEY = 'wm_pending_transactions_v1';
const LOCAL_PROJECTS_KEY = 'wm_offline_projects_v1';
const PENDING_PROJECTS_KEY = 'wm_pending_projects_v1';
const LOCAL_REQUISITIONS_KEY = 'wm_offline_requisitions_v1';
const PENDING_REQUISITIONS_KEY = 'wm_pending_requisitions_v1';
const LOCAL_REQUISITION_ITEMS_KEY = 'wm_offline_requisition_items_v1';
const LOCAL_REQUISITION_ID_MAP_KEY = 'wm_requisition_id_map_v1';
const LOCAL_EMPLOYEES_KEY = 'wm_offline_employees_v1';
const PENDING_EMPLOYEES_KEY = 'wm_pending_employees_v1';

const OFFLINE_BUDGET_KEY = (projectId: string) => `wm_budget_v1_${projectId}`;
const PENDING_BUDGETS_KEY = 'wm_pending_budgets_v1';

const OFFLINE_PROGRESS_KEY = (projectId: string) => `wm_progress_v1_${projectId}`;
const PENDING_PROGRESS_KEY = 'wm_pending_progress_v1';

const LOCAL_SUPPLIERS_KEY = 'wm_offline_suppliers_v1';
const PENDING_SUPPLIERS_KEY = 'wm_pending_suppliers_v1';

const LOCAL_QUOTES_KEY = 'wm_offline_quotes_v1';
const PENDING_QUOTES_KEY = 'wm_pending_quotes_v1';

const STORAGE_PAY_RATES = 'wm_pay_rates_v1';
const STORAGE_EMPLOYEE_OVERRIDES = 'wm_employee_overrides_v1';
const STORAGE_CONTRACTS = 'wm_contract_records_v1';

const PENDING_PAY_RATES_KEY = 'wm_pending_pay_rates_v1';
const PENDING_EMPLOYEE_OVERRIDES_KEY = 'wm_pending_employee_overrides_v1';
const PENDING_CONTRACTS_KEY = 'wm_pending_contracts_v1';

const LOCAL_ATTENDANCE_MANUAL_KEY = 'wm_offline_attendance_manual_v1';
const PENDING_ATTENDANCE_MANUAL_KEY = 'wm_pending_attendance_manual_v1';
const PENDING_ATTENDANCE_TOKENS_KEY = 'wm_pending_attendance_tokens_v1';

const PENDING_REQUISITION_STATUS_KEY = 'wm_pending_requisition_status_v1';
const PENDING_REQUISITION_ACTUAL_COSTS_KEY = 'wm_pending_requisition_actual_costs_v1';

type Json = any;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: Json) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function readObject(key: string): Record<string, any> {
  const v = readJson<any>(key, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function mapRequisitionId(requisitionId: string): string {
  if (!requisitionId) return requisitionId;
  const map = readObject(LOCAL_REQUISITION_ID_MAP_KEY);
  const mapped = map[String(requisitionId)];
  return mapped ? String(mapped) : requisitionId;
}

function setRequisitionIdMapping(localId: string, remoteId: string) {
  if (!localId || !remoteId || localId === remoteId) return;
  const map = readObject(LOCAL_REQUISITION_ID_MAP_KEY);
  map[String(localId)] = String(remoteId);
  writeJson(LOCAL_REQUISITION_ID_MAP_KEY, map);
}

function upsertById<T extends { id: string }>(rows: T[], row: T): T[] {
  const idx = rows.findIndex((r) => r.id === row.id);
  if (idx >= 0) {
    const next = [...rows];
    next[idx] = row;
    return next;
  }
  return [row, ...rows];
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

const syncOfflineTransactions = async (targetOrgId: string) => {
  try {
    const raw = localStorage.getItem(PENDING_TRANSACTIONS_KEY);
    const pending: any[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(pending) || pending.length === 0) return;

    const stillPending: any[] = [];

    for (const tx of pending) {
      try {
        await dbCreateTransaction(targetOrgId, tx);
      } catch (e) {
        console.error('Error sincronizando transacción pendiente', e);
        stillPending.push(tx);
      }
    }

    localStorage.setItem(PENDING_TRANSACTIONS_KEY, JSON.stringify(stillPending));
  } catch (e) {
    console.error('Error procesando transacciones pendientes', e);
  }
};

const syncOfflineBudgets = async (targetOrgId: string) => {
  const pendingProjectIds = readJson<string[]>(PENDING_BUDGETS_KEY, []);
  if (!Array.isArray(pendingProjectIds) || pendingProjectIds.length === 0) return;

  const stillPending: string[] = [];
  for (const projectId of uniq(pendingProjectIds)) {
    try {
      const payload = readJson<any | null>(OFFLINE_BUDGET_KEY(projectId), null);
      if (!payload) continue;
      await saveBudgetForProject(targetOrgId, projectId, String(payload.typology || ''), String(payload.indirectPct || '0'), payload.lines || []);
    } catch (e) {
      console.error('Error sincronizando presupuesto pendiente', e);
      stillPending.push(projectId);
    }
  }

  writeJson(PENDING_BUDGETS_KEY, uniq(stillPending));
};

const syncOfflineProgress = async (targetOrgId: string) => {
  const pendingProjectIds = readJson<string[]>(PENDING_PROGRESS_KEY, []);
  if (!Array.isArray(pendingProjectIds) || pendingProjectIds.length === 0) return;

  const stillPending: string[] = [];
  for (const projectId of uniq(pendingProjectIds)) {
    try {
      const payload = readJson<any | null>(OFFLINE_PROGRESS_KEY(projectId), null);
      if (!payload) continue;
      await saveProgressForProject(targetOrgId, projectId, payload);
    } catch (e) {
      console.error('Error sincronizando avance pendiente', e);
      stillPending.push(projectId);
    }
  }

  writeJson(PENDING_PROGRESS_KEY, uniq(stillPending));
};

const syncOfflineSuppliers = async (targetOrgId: string) => {
  const ops = readJson<any[]>(PENDING_SUPPLIERS_KEY, []);
  if (!Array.isArray(ops) || ops.length === 0) return;

  const stillPending: any[] = [];
  for (const op of ops) {
    try {
      if (op?.type === 'delete' && op?.id) {
        await deleteSupplier(targetOrgId, String(op.id));
      } else if (op?.type === 'upsert' && op?.supplier) {
        await upsertSupplier(targetOrgId, op.supplier);
      }
    } catch (e) {
      console.error('Error sincronizando proveedor pendiente', e);
      stillPending.push(op);
    }
  }
  writeJson(PENDING_SUPPLIERS_KEY, stillPending);
};

const syncOfflineQuotes = async (targetOrgId: string) => {
  const ops = readJson<any[]>(PENDING_QUOTES_KEY, []);
  if (!Array.isArray(ops) || ops.length === 0) return;

  const stillPending: any[] = [];
  for (const op of ops) {
    try {
      if (op?.type === 'delete' && op?.id) {
        await deleteServiceQuote(targetOrgId, String(op.id));
      } else if (op?.type === 'upsert' && op?.quote) {
        await upsertServiceQuote(targetOrgId, op.quote);
      }
    } catch (e) {
      console.error('Error sincronizando cotización pendiente', e);
      stillPending.push(op);
    }
  }
  writeJson(PENDING_QUOTES_KEY, stillPending);
};

const syncOfflinePayRates = async (targetOrgId: string) => {
  const pending = readJson<any | null>(PENDING_PAY_RATES_KEY, null);
  if (!pending) return;
  try {
    await upsertOrgPayRates(targetOrgId, pending);
    localStorage.removeItem(PENDING_PAY_RATES_KEY);
  } catch (e) {
    console.error('Error sincronizando pay rates pendientes', e);
  }
};

const syncOfflineEmployeeOverrides = async (targetOrgId: string) => {
  const ops = readJson<any[]>(PENDING_EMPLOYEE_OVERRIDES_KEY, []);
  if (!Array.isArray(ops) || ops.length === 0) return;

  const stillPending: any[] = [];
  for (const op of ops) {
    try {
      if (op?.type === 'delete' && op?.employeeId) {
        await deleteEmployeeRateOverride(targetOrgId, String(op.employeeId));
      } else if (op?.type === 'upsert' && op?.employeeId && op?.dailyRate != null) {
        await upsertEmployeeRateOverride(targetOrgId, String(op.employeeId), Number(op.dailyRate));
      }
    } catch (e) {
      console.error('Error sincronizando override pendiente', e);
      stillPending.push(op);
    }
  }
  writeJson(PENDING_EMPLOYEE_OVERRIDES_KEY, stillPending);
};

const syncOfflineContracts = async (targetOrgId: string) => {
  const pending = readJson<any[]>(PENDING_CONTRACTS_KEY, []);
  if (!Array.isArray(pending) || pending.length === 0) return;

  const stillPending: any[] = [];
  for (const rec of pending) {
    try {
      await upsertEmployeeContract(targetOrgId, rec);
    } catch (e) {
      console.error('Error sincronizando contrato pendiente', e);
      stillPending.push(rec);
    }
  }
  writeJson(PENDING_CONTRACTS_KEY, stillPending);
};

const syncOfflineAttendanceTokens = async () => {
  const pending = readJson<any[]>(PENDING_ATTENDANCE_TOKENS_KEY, []);
  if (!Array.isArray(pending) || pending.length === 0) return;

  const stillPending: any[] = [];
  for (const entry of pending) {
    try {
      if (!entry?.employeeId || !entry?.token) continue;
      await setEmployeeAttendanceToken(String(entry.employeeId), String(entry.token));
    } catch (e) {
      console.error('Error sincronizando token de asistencia pendiente', e);
      stillPending.push(entry);
    }
  }
  writeJson(PENDING_ATTENDANCE_TOKENS_KEY, stillPending);
};

const syncOfflineAttendanceManual = async (targetOrgId: string) => {
  const ops = readJson<any[]>(PENDING_ATTENDANCE_MANUAL_KEY, []);
  if (!Array.isArray(ops) || ops.length === 0) return;

  const stillPending: any[] = [];
  for (const op of ops) {
    try {
      const supabase = getSupabaseClient();
      if (op?.type === 'delete' && op?.id) {
        const res = await supabase.from('attendance').delete().eq('org_id', targetOrgId).eq('id', String(op.id));
        if ((res as any).error) throw (res as any).error;
      } else if (op?.type === 'upsert' && op?.row) {
        const row = { ...op.row, org_id: targetOrgId };
        const res = await supabase.from('attendance').upsert([row], { onConflict: 'org_id,id' });
        if ((res as any).error) throw (res as any).error;
      }
    } catch (e) {
      console.error('Error sincronizando asistencia manual pendiente', e);
      stillPending.push(op);
    }
  }
  writeJson(PENDING_ATTENDANCE_MANUAL_KEY, stillPending);
};

const syncOfflineRequisitionMutations = async (targetOrgId: string) => {
  const statusOps = readJson<any[]>(PENDING_REQUISITION_STATUS_KEY, []);
  const costOps = readJson<any[]>(PENDING_REQUISITION_ACTUAL_COSTS_KEY, []);
  const idMap = readObject(LOCAL_REQUISITION_ID_MAP_KEY);
  const resolveId = (id: any) => {
    const s = String(id ?? '');
    return idMap[s] ? String(idMap[s]) : s;
  };

  if (Array.isArray(statusOps) && statusOps.length > 0) {
    const still: any[] = [];
    for (const op of statusOps) {
      try {
        if (!op?.requisitionId || !op?.status) continue;
        await updateRequisitionStatus(targetOrgId, resolveId(op.requisitionId), op.status);
      } catch (e) {
        console.error('Error sincronizando status requisición', e);
        still.push(op);
      }
    }
    writeJson(PENDING_REQUISITION_STATUS_KEY, still);
  }

  if (Array.isArray(costOps) && costOps.length > 0) {
    const still: any[] = [];
    for (const op of costOps) {
      try {
        if (!op?.requisitionId || !Array.isArray(op?.updates)) continue;
        await setRequisitionItemsActualUnitCosts(targetOrgId, resolveId(op.requisitionId), op.updates);
      } catch (e) {
        console.error('Error sincronizando costos reales requisición', e);
        still.push(op);
      }
    }
    writeJson(PENDING_REQUISITION_ACTUAL_COSTS_KEY, still);
  }
};

const syncOfflineRequisitions = async (targetOrgId: string) => {
  try {
    const raw = localStorage.getItem(PENDING_REQUISITIONS_KEY);
    const pending: any[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(pending) || pending.length === 0) return;

    const stillPending: any[] = [];

    for (const entry of pending) {
      try {
        const { localId, projectId, supplierName, sourceBudgetLineId, items, sourceLineName } = entry || {};
        if (!projectId || !Array.isArray(items) || items.length === 0) {
          continue;
        }
        const remoteId = await createRequisition(
          targetOrgId,
          projectId,
          supplierName ?? null,
          sourceBudgetLineId ?? null,
          items,
          'sent',
          sourceLineName ?? null
        );

        if (localId && remoteId) {
          setRequisitionIdMapping(String(localId), String(remoteId));

          // Update local requisitions history id so Compras continues to work.
          try {
            const existing = readJson<any[]>(LOCAL_REQUISITIONS_KEY, []);
            if (Array.isArray(existing)) {
              writeJson(
                LOCAL_REQUISITIONS_KEY,
                existing.map((r) => (String(r?.id) === String(localId) ? { ...r, id: String(remoteId) } : r))
              );
            }
          } catch {
            // ignore
          }

          // Cache remote items and migrate any locally-entered actual costs.
          try {
            const map = readObject(LOCAL_REQUISITION_ITEMS_KEY);
            const localItems = Array.isArray(map[String(localId)]) ? (map[String(localId)] as any[]) : null;

            const remoteRows = await listRequisitionItems(targetOrgId, String(remoteId));
            const remoteItems = remoteRows.map((r) => ({
              id: r.id,
              name: r.name,
              unit: r.unit,
              quantity: r.quantity,
              unitPrice: r.unitPrice,
              actualUnitCost: r.actualUnitCost,
            }));

            map[String(remoteId)] = remoteItems;
            delete map[String(localId)];
            writeJson(LOCAL_REQUISITION_ITEMS_KEY, map);

            if (localItems && localItems.length > 0) {
              const updates: Array<{ id: string; actualUnitCost: number | null }> = [];
              for (let i = 0; i < remoteItems.length; i++) {
                const localCost = localItems[i]?.actualUnitCost;
                if (localCost === null || localCost === undefined) continue;
                updates.push({ id: String(remoteItems[i].id), actualUnitCost: Number(localCost) });
              }
              if (updates.length > 0) {
                await setRequisitionItemsActualUnitCosts(targetOrgId, String(remoteId), updates);
                const byId = new Map<string, number | null>();
                updates.forEach((u) => byId.set(String(u.id), u.actualUnitCost));
                map[String(remoteId)] = remoteItems.map((it) => ({
                  ...it,
                  actualUnitCost: byId.has(String(it.id)) ? byId.get(String(it.id))! : it.actualUnitCost,
                }));
                writeJson(LOCAL_REQUISITION_ITEMS_KEY, map);
              }
            }
          } catch (e) {
            console.error('Error migrando items/costos de requisición offline', e);
          }

          // Rewrite pending status/cost ops that still reference the localId
          try {
            const statusOps = readJson<any[]>(PENDING_REQUISITION_STATUS_KEY, []);
            if (Array.isArray(statusOps)) {
              writeJson(
                PENDING_REQUISITION_STATUS_KEY,
                statusOps.map((op) =>
                  String(op?.requisitionId) === String(localId) ? { ...op, requisitionId: String(remoteId) } : op
                )
              );
            }
          } catch {
            // ignore
          }

          try {
            const costOps = readJson<any[]>(PENDING_REQUISITION_ACTUAL_COSTS_KEY, []);
            if (Array.isArray(costOps)) {
              writeJson(
                PENDING_REQUISITION_ACTUAL_COSTS_KEY,
                costOps.map((op) =>
                  String(op?.requisitionId) === String(localId) ? { ...op, requisitionId: String(remoteId) } : op
                )
              );
            }
          } catch {
            // ignore
          }
        }
      } catch (e) {
        console.error('Error sincronizando requisición pendiente', e);
        stillPending.push(entry);
      }
    }

    localStorage.setItem(PENDING_REQUISITIONS_KEY, JSON.stringify(stillPending));
  } catch (e) {
    console.error('Error procesando requisiciones pendientes', e);
  }
};

const syncOfflineEmployees = async (targetOrgId: string) => {
  try {
    const raw = localStorage.getItem(PENDING_EMPLOYEES_KEY);
    const pending: any[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(pending) || pending.length === 0) return;

    const stillPending: any[] = [];

    for (const emp of pending) {
      try {
        await createEmployee(targetOrgId, emp);
      } catch (e) {
        console.error('Error sincronizando empleado pendiente', e);
        stillPending.push(emp);
      }
    }

    localStorage.setItem(PENDING_EMPLOYEES_KEY, JSON.stringify(stillPending));
  } catch (e) {
    console.error('Error procesando empleados pendientes', e);
  }
};

const syncOfflineProjects = async (targetOrgId: string) => {
  const ops = readJson<any[]>(PENDING_PROJECTS_KEY, []);
  if (!Array.isArray(ops) || ops.length === 0) return;

  const still: any[] = [];
  for (const op of ops) {
    try {
      const t = String(op?.type || '');
      if (t === 'create' && op?.project) {
        await dbCreateProject(targetOrgId, op.project);
      } else if (t === 'update' && op?.projectId && op?.patch) {
        await dbUpdateProject(targetOrgId, String(op.projectId), op.patch);
      } else if (t === 'delete' && op?.projectId) {
        await dbDeleteProject(targetOrgId, String(op.projectId));
      }
    } catch (e) {
      console.error('Error sincronizando proyecto pendiente', e);
      still.push(op);
    }
  }
  writeJson(PENDING_PROJECTS_KEY, still);
};

const App: React.FC = () => {
  const [hash, setHash] = useState<string>(() => (typeof window !== 'undefined' ? window.location.hash || '' : ''));

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash || '');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>('WELCOME');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const [syncVersion, setSyncVersion] = useState(0);
  const realtimeChannelRef = useRef<any>(null);
  const realtimeBumpTimerRef = useRef<number | null>(null);
  const realtimeProjectsTimerRef = useRef<number | null>(null);

  // Global State (Mocking a database)
  const [projects, setProjects] = useState<Project[]>([]);
  
  // State to handle navigation from Proyectos to Presupuestos with a specific project selected
  const [preselectedProjectId, setPreselectedProjectId] = useState<string>('');

  // State to handle navigation from Presupuestos to Compras with requisition data
  const [requisitionData, setRequisitionData] = useState<RequisitionData | null>(null);

  // State to handle navigation from Proyectos to Cotizador with client data
  const [quoteInitialData, setQuoteInitialData] = useState<QuoteInitialData | null>(null);
  
  // Initialize from LocalStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_PROJECTS_KEY) ?? localStorage.getItem('projects');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setProjects(parsed);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(projects));
      // Keep backward-compat for older builds that used 'projects'
      localStorage.setItem('projects', JSON.stringify(projects));
    } catch {
      // ignore
    }
  }, [projects]);

  const refreshProjects = async (targetOrgId: string) => {
    try {
      const next = await listProjects(targetOrgId);
      setProjects(next);
      writeJson(LOCAL_PROJECTS_KEY, next);
      return;
    } catch (e) {
      console.error(e);
    }
    const cached = readJson<Project[]>(LOCAL_PROJECTS_KEY, []);
    if (Array.isArray(cached)) setProjects(cached);
  };

  // Centralized Realtime: bump syncVersion so modules can reload when open.
  // We keep this at App level to cover modules that don't have their own per-view subscriptions.
  useEffect(() => {
    if (!isSupabaseConfigured || !orgId) return;

    const supabase = getSupabaseClient();

    const clearTimers = () => {
      if (realtimeBumpTimerRef.current) window.clearTimeout(realtimeBumpTimerRef.current);
      realtimeBumpTimerRef.current = null;
      if (realtimeProjectsTimerRef.current) window.clearTimeout(realtimeProjectsTimerRef.current);
      realtimeProjectsTimerRef.current = null;
    };

    const scheduleBump = () => {
      if (realtimeBumpTimerRef.current) window.clearTimeout(realtimeBumpTimerRef.current);
      realtimeBumpTimerRef.current = window.setTimeout(() => {
        setSyncVersion((v) => v + 1);
      }, 250);
    };

    const scheduleProjectsRefresh = () => {
      if (realtimeProjectsTimerRef.current) window.clearTimeout(realtimeProjectsTimerRef.current);
      realtimeProjectsTimerRef.current = window.setTimeout(() => {
        void refreshProjects(orgId);
      }, 400);
    };

    const attachTable = (channel: any, table: string) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `org_id=eq.${orgId}` },
        () => {
          scheduleBump();
          if (table === 'projects') scheduleProjectsRefresh();
        }
      );
    };

    // Cleanup any previous channel (defensive).
    try {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    } catch {
      // ignore
    }
    clearTimers();

    const channel = supabase.channel(`app-realtime:${orgId}`);
    // Core + modules tables.
    const tables = [
      'projects',
      'transactions',
      'budgets',
      'budget_lines',
      'budget_line_materials',
      'suppliers',
      'requisitions',
      'requisition_items',
      'employees',
      'employee_contracts',
      'org_pay_rates',
      'employee_rate_overrides',
      'service_quotes',
      'project_progress',
      'project_progress_lines',
      'attendance',
      'employee_attendance_tokens',
      'notifications',
    ];
    for (const t of tables) attachTable(channel, t);

    channel.subscribe();
    realtimeChannelRef.current = channel;

    return () => {
      clearTimers();
      try {
        if (realtimeChannelRef.current) {
          supabase.removeChannel(realtimeChannelRef.current);
          realtimeChannelRef.current = null;
        }
      } catch {
        // ignore
      }
    };
  }, [orgId]);

  const handleCreateProject = async (partial: Partial<Project>) => {
    const localId = crypto.randomUUID();
    const newProject: Project = {
      id: localId,
      name: partial.name || '',
      clientName: partial.clientName || '',
      location: partial.location || '',
      lot: partial.lot,
      block: partial.block,
      coordinates: partial.coordinates,
      areaLand: Number(partial.areaLand || 0),
      areaBuild: Number(partial.areaBuild || 0),
      needs: partial.needs || '',
      status: (partial.status as any) || 'standby',
      startDate: partial.startDate || new Date().toISOString(),
      typology: partial.typology as any,
      projectManager: partial.projectManager || '',
    };

    // Always save locally first
    setProjects((prev) => [newProject, ...prev]);

    if (isSupabaseConfigured && orgId) {
      try {
        const created = await dbCreateProject(orgId, { ...partial, id: localId });
        // Same id, but reconcile server fields.
        setProjects((prev) => prev.map((p) => (p.id === localId ? created : p)));
        return created;
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_PROJECTS_KEY, []);
    const next = Array.isArray(pending) ? pending : [];
    next.push({ type: 'create', project: { ...partial, id: localId } });
    writeJson(PENDING_PROJECTS_KEY, next);
    return newProject;
  };

  const handleUpdateProject = async (projectId: string, patch: Partial<Project>) => {
    // Always update local view first
    setProjects((prev) => prev.map((p) => (p.id === projectId ? ({ ...p, ...patch } as Project) : p)));

    if (isSupabaseConfigured && orgId) {
      try {
        const updated = await dbUpdateProject(orgId, projectId, patch);
        setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)));
        return;
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_PROJECTS_KEY, []);
    const next = Array.isArray(pending) ? pending : [];
    next.push({ type: 'update', projectId, patch });
    writeJson(PENDING_PROJECTS_KEY, next);
  };

  const handleDeleteProject = async (projectId: string) => {
    // Always delete locally first
    setProjects((prev) => prev.filter((p) => p.id !== projectId));

    if (isSupabaseConfigured && orgId) {
      try {
        await dbDeleteProject(orgId, projectId);
        return;
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_PROJECTS_KEY, []);
    const next = Array.isArray(pending) ? pending : [];
    next.push({ type: 'delete', projectId });
    writeJson(PENDING_PROJECTS_KEY, next);
  };

  const handleCreateTransaction = async (tx: any) => {
    if (!isSupabaseConfigured || !orgId) {
      try {
        const raw = localStorage.getItem(LOCAL_TRANSACTIONS_KEY);
        const existing: any[] = raw ? JSON.parse(raw) : [];

        const withId = tx && tx.id ? tx : { ...tx, id: crypto.randomUUID() };
        const withDate = (withId as any).date ? withId : { ...withId, date: new Date().toISOString() };

        existing.push(withDate);
        localStorage.setItem(LOCAL_TRANSACTIONS_KEY, JSON.stringify(existing));

        // Marcar también como pendiente para sincronizar cuando haya conexión
        try {
          const rawPending = localStorage.getItem(PENDING_TRANSACTIONS_KEY);
          const pending: any[] = rawPending ? JSON.parse(rawPending) : [];
          pending.push(withDate);
          localStorage.setItem(PENDING_TRANSACTIONS_KEY, JSON.stringify(pending));
        } catch (err) {
          console.error('Error marcando transacción como pendiente', err);
        }
      } catch (e) {
        console.error('Error guardando transacción local', e);
      }
      return;
    }
    await dbCreateTransaction(orgId, tx);
  };

  const handleLoadBudget = async (projectId: string) => {
    if (!projectId) return null;
    if (isSupabaseConfigured && orgId) {
      try {
        const remote = await loadBudgetForProject(orgId, projectId);
        if (remote) {
          writeJson(OFFLINE_BUDGET_KEY(projectId), remote);
        }
        return remote;
      } catch (e: any) {
        console.error(e);
        // fallback local
      }
    }
    return readJson<any | null>(OFFLINE_BUDGET_KEY(projectId), null);
  };

  const handleSaveBudget = async (projectId: string, typology: string, indirectPct: string, lines: any[]) => {
    if (!projectId) return;
    const localPayload = { typology, indirectPct, lines: Array.isArray(lines) ? lines : [] };
    writeJson(OFFLINE_BUDGET_KEY(projectId), localPayload);
    const pending = readJson<string[]>(PENDING_BUDGETS_KEY, []);
    writeJson(PENDING_BUDGETS_KEY, uniq([...(Array.isArray(pending) ? pending : []), projectId]));

    if (isSupabaseConfigured && orgId) {
      try {
        await saveBudgetForProject(orgId, projectId, typology, indirectPct, lines as any);
        const nextPending = readJson<string[]>(PENDING_BUDGETS_KEY, []).filter((id) => id !== projectId);
        writeJson(PENDING_BUDGETS_KEY, uniq(nextPending));
      } catch (e: any) {
        console.error(e);
        // keep pending
      }
    }
  };

  const handleLoadProgress = async (projectId: string) => {
    if (!projectId) return null;
    if (isSupabaseConfigured && orgId) {
      try {
        const remote = await loadProgressForProject(orgId, projectId);
        if (remote) writeJson(OFFLINE_PROGRESS_KEY(projectId), remote);
        return remote;
      } catch (e) {
        console.error(e);
      }
    }
    return readJson<any | null>(OFFLINE_PROGRESS_KEY(projectId), null);
  };

  const handleSaveProgress = async (projectId: string, payload: any) => {
    if (!projectId) return;
    writeJson(OFFLINE_PROGRESS_KEY(projectId), payload);
    const pending = readJson<string[]>(PENDING_PROGRESS_KEY, []);
    writeJson(PENDING_PROGRESS_KEY, uniq([...(Array.isArray(pending) ? pending : []), projectId]));

    if (isSupabaseConfigured && orgId) {
      try {
        await saveProgressForProject(orgId, projectId, payload);
        const nextPending = readJson<string[]>(PENDING_PROGRESS_KEY, []).filter((id) => id !== projectId);
        writeJson(PENDING_PROGRESS_KEY, uniq(nextPending));
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleImportMaterialPrices = async (input: { url: string; vendor: string; currency: string }) => {
    if (!isSupabaseConfigured || !orgId) throw new Error('Supabase no configurado.');
    return await importMaterialPricesFromCsvUrl(orgId, input);
  };

  const handleImportMaterialPricesText = async (input: { csvText: string; vendor: string; currency: string }) => {
    if (!isSupabaseConfigured || !orgId) throw new Error('Supabase no configurado.');
    return await importMaterialPricesFromCsvText(orgId, { ...input, sourceType: 'upload', sourceUrl: null });
  };

  const handleSuggestLineFromCatalog = async (typology: string, lineName: string) => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await suggestLineFromApuCatalog(orgId, typology, lineName);
  };

  const handleImportApuTemplates = async (input: { url: string; source?: string; currency?: string }) => {
    if (!isSupabaseConfigured || !orgId) throw new Error('Supabase no configurado.');
    return await importApuTemplatesFromJsonUrl(orgId, input);
  };

  const handleImportApuTemplatesCsv = async (input: { url: string; source?: string; currency?: string }) => {
    if (!isSupabaseConfigured || !orgId) throw new Error('Supabase no configurado.');
    return await importApuTemplatesFromCsvUrl(orgId, input);
  };

  const handleImportApuTemplatesCsvText = async (input: { csvText: string; source?: string; currency?: string }) => {
    if (!isSupabaseConfigured || !orgId) throw new Error('Supabase no configurado.');
    return await importApuTemplatesFromCsvText(orgId, { ...input, sourceUrl: null });
  };

  const handleCreateRequisition = async (data: RequisitionData, supplierName: string | null) => {
    if (!isSupabaseConfigured || !orgId) {
      try {
        const nowIso = new Date().toISOString();

        // Historial local para Compras
        const raw = localStorage.getItem(LOCAL_REQUISITIONS_KEY);
        const existing: any[] = raw ? JSON.parse(raw) : [];
        const total = (data.items ?? []).reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
        const localReqId = crypto.randomUUID();
        const localReq = {
          id: localReqId,
          projectId: data.projectId ?? null,
          requestedAt: nowIso,
          supplierName: supplierName ?? null,
          supplierNote: data.sourceLineName ?? null,
          total,
          actualTotal: 0,
          status: 'sent',
        };
        existing.unshift(localReq);
        localStorage.setItem(LOCAL_REQUISITIONS_KEY, JSON.stringify(existing));

        // Cache items locally so invoice modal can work offline.
        try {
          const itemRows = (data.items ?? []).map((it, idx) => ({
            id: `${localReqId}:${idx}`,
            name: it.name,
            unit: it.unit,
            quantity: it.quantity,
            unitPrice: null,
            actualUnitCost: null,
          }));
          const map = readObject(LOCAL_REQUISITION_ITEMS_KEY);
          map[String(localReqId)] = itemRows;
          writeJson(LOCAL_REQUISITION_ITEMS_KEY, map);
        } catch {
          // ignore
        }

        // Cola de sincronización
        try {
          const rawPending = localStorage.getItem(PENDING_REQUISITIONS_KEY);
          const pending: any[] = rawPending ? JSON.parse(rawPending) : [];
          pending.push({
            localId: localReqId,
            projectId: data.projectId,
            supplierName,
            sourceBudgetLineId: data.sourceBudgetLineId ?? null,
            items: data.items,
            sourceLineName: data.sourceLineName ?? null,
          });
          localStorage.setItem(PENDING_REQUISITIONS_KEY, JSON.stringify(pending));
        } catch (err) {
          console.error('Error marcando requisición como pendiente', err);
        }
      } catch (e) {
        console.error('Error guardando requisición local', e);
      }
      return;
    }
    const reqId = await createRequisition(
      orgId,
      data.projectId,
      supplierName,
      data.sourceBudgetLineId ?? null,
      data.items,
      'sent'
    );

    // Cache requisition items locally (supports offline invoice edits).
    try {
      const rows = await listRequisitionItems(orgId, reqId);
      const mapped = rows.map((r) => ({
        id: r.id,
        name: r.name,
        unit: r.unit,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        actualUnitCost: r.actualUnitCost,
      }));
      const map = readObject(LOCAL_REQUISITION_ITEMS_KEY);
      map[String(reqId)] = mapped;
      writeJson(LOCAL_REQUISITION_ITEMS_KEY, map);
    } catch {
      // ignore
    }
  };

  const handleListRequisitions = async () => {
    if (!isSupabaseConfigured || !orgId) {
      try {
        const raw = localStorage.getItem(LOCAL_REQUISITIONS_KEY);
        const existing: any[] = raw ? JSON.parse(raw) : [];
        return existing;
      } catch (e) {
        console.error('Error leyendo requisiciones locales', e);
        return [];
      }
    }
    return await listRequisitions(orgId);
  };

  // Handler for updating requisition status
  const handleUpdateRequisitionStatus = async (
    requisitionId: string,
    status: 'received' | 'draft' | 'sent' | 'confirmed' | 'cancelled'
  ) => {
    if (!requisitionId) return;
    const resolvedId = mapRequisitionId(requisitionId);
    // Always update local view if present
    try {
      const existing = readJson<any[]>(LOCAL_REQUISITIONS_KEY, []);
      if (Array.isArray(existing) && existing.length > 0) {
        writeJson(
          LOCAL_REQUISITIONS_KEY,
          existing.map((r) =>
            String(r?.id) === String(requisitionId) || String(r?.id) === String(resolvedId) ? { ...r, status } : r
          )
        );
      }
    } catch {
      // ignore
    }

    if (isSupabaseConfigured && orgId) {
      try {
        await updateRequisitionStatus(orgId, resolvedId, status);
        return;
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_REQUISITION_STATUS_KEY, []);
    const next = Array.isArray(pending) ? pending.filter((p) => p?.requisitionId !== resolvedId) : [];
    next.push({ requisitionId: resolvedId, status });
    writeJson(PENDING_REQUISITION_STATUS_KEY, next);
  };

  const handleListRequisitionItems = async (
    requisitionId: string
  ): Promise<Array<{ id: string; name: string; unit: string; quantity: number; unitPrice: number | null; actualUnitCost: number | null }> | null> => {
    const resolvedId = mapRequisitionId(requisitionId);

    // Try cloud first; fall back to local cache.
    if (isSupabaseConfigured && orgId) {
      try {
        const rows = await listRequisitionItems(orgId, resolvedId);
        const mapped = rows.map((r) => ({
          id: r.id,
          name: r.name,
          unit: r.unit,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          actualUnitCost: r.actualUnitCost,
        }));
        const map = readObject(LOCAL_REQUISITION_ITEMS_KEY);
        map[String(resolvedId)] = mapped;
        writeJson(LOCAL_REQUISITION_ITEMS_KEY, map);
        return mapped;
      } catch (e) {
        console.error(e);
      }
    }

    const map = readObject(LOCAL_REQUISITION_ITEMS_KEY);
    const cached = map[String(resolvedId)] ?? map[String(requisitionId)];
    return Array.isArray(cached) ? cached : [];
  };

  const handleSaveRequisitionActualCosts = async (
    requisitionId: string,
    updates: Array<{ id: string; actualUnitCost: number | null }>
  ) => {
    if (!requisitionId) return;
    const resolvedId = mapRequisitionId(requisitionId);

    // Always update local cached items so user sees changes offline.
    try {
      const map = readObject(LOCAL_REQUISITION_ITEMS_KEY);
      const current = map[String(resolvedId)] ?? map[String(requisitionId)];
      if (Array.isArray(current)) {
        const byId = new Map<string, any>();
        current.forEach((it: any) => {
          if (it?.id) byId.set(String(it.id), it);
        });
        for (const u of updates) {
          const it = byId.get(String(u.id));
          if (it) it.actualUnitCost = u.actualUnitCost;
        }
        map[String(resolvedId)] = Array.from(byId.values());
        writeJson(LOCAL_REQUISITION_ITEMS_KEY, map);
      }
    } catch {
      // ignore
    }

    if (isSupabaseConfigured && orgId) {
      try {
        await setRequisitionItemsActualUnitCosts(orgId, resolvedId, updates);
        return;
      } catch (e) {
        console.error(e);
      }
    }
    const pending = readJson<any[]>(PENDING_REQUISITION_ACTUAL_COSTS_KEY, []);
    const next = Array.isArray(pending) ? pending.filter((p) => p?.requisitionId !== resolvedId) : [];
    next.push({ requisitionId: resolvedId, updates });
    writeJson(PENDING_REQUISITION_ACTUAL_COSTS_KEY, next);
  };

  const handleListSuppliers = async () => {
    if (isSupabaseConfigured && orgId) {
      try {
        const rows = await listSuppliers(orgId, 100);
        const mapped = rows.map((r) => ({
          id: r.id,
          name: r.name,
          whatsapp: r.whatsapp,
          phone: r.phone,
          defaultNoteTemplate: r.defaultNoteTemplate,
          termsTemplate: r.termsTemplate,
        }));
        writeJson(LOCAL_SUPPLIERS_KEY, mapped);
        return mapped;
      } catch (e) {
        console.error(e);
      }
    }
    const rows = readJson<any[]>(LOCAL_SUPPLIERS_KEY, []);
    return Array.isArray(rows) ? rows : [];
  };

  const handleUpsertSupplier = async (input: {
    id?: string | null;
    name: string;
    whatsapp?: string | null;
    phone?: string | null;
    defaultNoteTemplate?: string | null;
    termsTemplate?: string | null;
  }): Promise<{ id: string } | null> => {
    const offlineId = input.id ?? crypto.randomUUID();
    const localRow = {
      id: offlineId,
      name: input.name,
      whatsapp: input.whatsapp ?? null,
      phone: input.phone ?? null,
      defaultNoteTemplate: input.defaultNoteTemplate ?? null,
      termsTemplate: input.termsTemplate ?? null,
    };
    const existing = readJson<any[]>(LOCAL_SUPPLIERS_KEY, []);
    writeJson(LOCAL_SUPPLIERS_KEY, upsertById(Array.isArray(existing) ? existing : [], localRow));

    if (isSupabaseConfigured && orgId) {
      try {
        const rec = await upsertSupplier(orgId, {
          id: offlineId,
          name: input.name,
          whatsapp: input.whatsapp ?? null,
          phone: input.phone ?? null,
          defaultNoteTemplate: input.defaultNoteTemplate ?? null,
          termsTemplate: input.termsTemplate ?? null,
          email: null,
          notes: null,
        });
        return { id: rec.id };
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_SUPPLIERS_KEY, []);
    const next = Array.isArray(pending) ? pending.filter((p) => !(p?.type === 'upsert' && p?.supplier?.id === offlineId)) : [];
    next.push({ type: 'upsert', supplier: { ...localRow, email: null, notes: null } });
    writeJson(PENDING_SUPPLIERS_KEY, next);
    return { id: offlineId };
  };

  const handleDeleteSupplier = async (supplierId: string) => {
    if (!supplierId) return;
    const existing = readJson<any[]>(LOCAL_SUPPLIERS_KEY, []);
    if (Array.isArray(existing)) {
      writeJson(LOCAL_SUPPLIERS_KEY, existing.filter((s) => String(s?.id) !== String(supplierId)));
    }

    if (isSupabaseConfigured && orgId) {
      try {
        await deleteSupplier(orgId, supplierId);
        return;
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_SUPPLIERS_KEY, []);
    const next = Array.isArray(pending) ? pending.filter((p) => !(p?.type === 'delete' && p?.id === supplierId)) : [];
    next.push({ type: 'delete', id: supplierId });
    writeJson(PENDING_SUPPLIERS_KEY, next);
  };

  const handleListEmployees = async () => {
    if (!isSupabaseConfigured || !orgId) {
      try {
        const raw = localStorage.getItem(LOCAL_EMPLOYEES_KEY);
        const existing: any[] = raw ? JSON.parse(raw) : [];
        return existing;
      } catch (e) {
        console.error('Error leyendo empleados locales', e);
        return null;
      }
    }
    return await listEmployees(orgId);
  };

  const handleCreateEmployee = async (input: any) => {
    if (!isSupabaseConfigured || !orgId) {
      try {
        const raw = localStorage.getItem(LOCAL_EMPLOYEES_KEY);
        const existing: any[] = raw ? JSON.parse(raw) : [];
        const localEmp = {
          id: crypto.randomUUID(),
          name: input?.name ?? '',
          dpi: input?.dpi ?? null,
          phone: input?.phone ?? null,
          position: input?.position ?? '',
          dailyRate: Number(input?.dailyRate ?? 0) || 0,
          status: 'active',
          projectId: input?.projectId ?? null,
          createdAt: new Date().toISOString(),
        };
        existing.unshift(localEmp);
        localStorage.setItem(LOCAL_EMPLOYEES_KEY, JSON.stringify(existing));

        // Cola de sincronización
        try {
          const rawPending = localStorage.getItem(PENDING_EMPLOYEES_KEY);
          const pending: any[] = rawPending ? JSON.parse(rawPending) : [];
          pending.push({
            name: localEmp.name,
            dpi: localEmp.dpi ?? undefined,
            phone: localEmp.phone ?? undefined,
            position: localEmp.position,
            dailyRate: localEmp.dailyRate,
            projectId: localEmp.projectId ?? undefined,
          });
          localStorage.setItem(PENDING_EMPLOYEES_KEY, JSON.stringify(pending));
        } catch (err) {
          console.error('Error marcando empleado como pendiente', err);
        }

        return localEmp;
      } catch (e) {
        console.error('Error guardando empleado local', e);
        return null;
      }
    }
    return await createEmployee(orgId, input);
  };

  const handleLoadPayRates = async (): Promise<Record<string, number> | null> => {
    // Prefer cloud when available, but always fall back to local cache.
    if (isSupabaseConfigured && orgId) {
      try {
        const rates = await listOrgPayRates(orgId);
        writeJson(STORAGE_PAY_RATES, rates);
        return rates;
      } catch (e) {
        console.error(e);
      }
    }
    return readJson<Record<string, number> | null>(STORAGE_PAY_RATES, null);
  };

  const handleSavePayRates = async (payRates: Record<string, number>) => {
    writeJson(STORAGE_PAY_RATES, payRates);
    writeJson(PENDING_PAY_RATES_KEY, payRates);
    if (isSupabaseConfigured && orgId) {
      try {
        await upsertOrgPayRates(orgId, payRates);
        localStorage.removeItem(PENDING_PAY_RATES_KEY);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleLoadEmployeeRateOverrides = async (): Promise<Record<string, number> | null> => {
    if (isSupabaseConfigured && orgId) {
      try {
        const overrides = await listEmployeeRateOverrides(orgId);
        writeJson(STORAGE_EMPLOYEE_OVERRIDES, overrides);
        return overrides;
      } catch (e) {
        console.error(e);
      }
    }
    return readJson<Record<string, number> | null>(STORAGE_EMPLOYEE_OVERRIDES, null);
  };

  const handleUpsertEmployeeRateOverride = async (employeeId: string, dailyRate: number) => {
    const overrides = readJson<Record<string, number>>(STORAGE_EMPLOYEE_OVERRIDES, {} as any);
    writeJson(STORAGE_EMPLOYEE_OVERRIDES, { ...(overrides || {}), [employeeId]: dailyRate });

    if (isSupabaseConfigured && orgId) {
      try {
        await upsertEmployeeRateOverride(orgId, employeeId, dailyRate);
        return;
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_EMPLOYEE_OVERRIDES_KEY, []);
    const next = Array.isArray(pending)
      ? pending.filter((p) => !(p?.type === 'upsert' && p?.employeeId === employeeId))
      : [];
    next.push({ type: 'upsert', employeeId, dailyRate });
    writeJson(PENDING_EMPLOYEE_OVERRIDES_KEY, next);
  };

  const handleDeleteEmployeeRateOverride = async (employeeId: string) => {
    const overrides = readJson<Record<string, number>>(STORAGE_EMPLOYEE_OVERRIDES, {} as any);
    if (overrides && typeof overrides === 'object') {
      const next = { ...(overrides as any) };
      delete (next as any)[employeeId];
      writeJson(STORAGE_EMPLOYEE_OVERRIDES, next);
    }

    if (isSupabaseConfigured && orgId) {
      try {
        await deleteEmployeeRateOverride(orgId, employeeId);
        return;
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_EMPLOYEE_OVERRIDES_KEY, []);
    const next = Array.isArray(pending)
      ? pending.filter((p) => !(p?.type === 'delete' && p?.employeeId === employeeId))
      : [];
    next.push({ type: 'delete', employeeId });
    writeJson(PENDING_EMPLOYEE_OVERRIDES_KEY, next);
  };

  const handleListContracts = async (): Promise<any[] | null> => {
    if (isSupabaseConfigured && orgId) {
      try {
        const rows = await listEmployeeContracts(orgId, 50);
        writeJson(STORAGE_CONTRACTS, rows);
        return rows;
      } catch (e) {
        console.error(e);
      }
    }
    const rows = readJson<any[]>(STORAGE_CONTRACTS, []);
    return Array.isArray(rows) ? rows : [];
  };

  const handleUpsertContract = async (input: any): Promise<any> => {
    const withId = input && input.id ? input : { ...input, id: crypto.randomUUID() };
    const existing = readJson<any[]>(STORAGE_CONTRACTS, []);
    if (Array.isArray(existing)) {
      writeJson(STORAGE_CONTRACTS, upsertById(existing, withId));
    } else {
      writeJson(STORAGE_CONTRACTS, [withId]);
    }

    const pending = readJson<any[]>(PENDING_CONTRACTS_KEY, []);
    const nextPending = Array.isArray(pending) ? pending.filter((c) => c?.id !== withId.id) : [];
    nextPending.push(withId);
    writeJson(PENDING_CONTRACTS_KEY, nextPending);

    if (isSupabaseConfigured && orgId) {
      try {
        const saved = await upsertEmployeeContract(orgId, withId);
        // remove from pending if success
        const after = readJson<any[]>(PENDING_CONTRACTS_KEY, []).filter((c) => c?.id !== withId.id);
        writeJson(PENDING_CONTRACTS_KEY, after);
        return saved;
      } catch (e) {
        console.error(e);
      }
    }

    return withId;
  };

  const handleListAttendance = async (workDate: string): Promise<any[] | null> => {
    if (!workDate) return [];
    // Start with local manual attendance for the date.
    const localRowsAll = readJson<any[]>(LOCAL_ATTENDANCE_MANUAL_KEY, []);
    const localRows = Array.isArray(localRowsAll)
      ? localRowsAll.filter((r) => String(r?.work_date || r?.workDate || '') === String(workDate))
      : [];

    if (isSupabaseConfigured && orgId) {
      try {
        const remote = await listAttendanceForDate(orgId, workDate);
        // Merge local rows on top so user still sees unsynced edits.
        const merged = [...localRows, ...(Array.isArray(remote) ? remote : [])];
        return merged;
      } catch (e) {
        console.error(e);
      }
    }

    return localRows;
  };

  const handleSetAttendanceToken = async (employeeId: string, token: string) => {
    if (!employeeId || !token) return;
    if (isSupabaseConfigured && orgId) {
      try {
        await setEmployeeAttendanceToken(employeeId, token);
        return;
      } catch (e) {
        console.error(e);
      }
    }
    const pending = readJson<any[]>(PENDING_ATTENDANCE_TOKENS_KEY, []);
    const next = Array.isArray(pending) ? pending.filter((p) => p?.employeeId !== employeeId) : [];
    next.push({ employeeId, token });
    writeJson(PENDING_ATTENDANCE_TOKENS_KEY, next);
  };

  const handleListQuotes = async () => {
    if (isSupabaseConfigured && orgId) {
      try {
        const rows = await listServiceQuotes(orgId, { limit: 50 });
        const mapped = rows.map((r) => ({
          id: r.id,
          client: r.client,
          phone: r.phone,
          address: r.address,
          serviceName: r.serviceName,
          quantity: r.quantity,
          unit: r.unit,
          unitPrice: r.unitPrice,
          total: r.total,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
        writeJson(LOCAL_QUOTES_KEY, mapped);
        return mapped;
      } catch (e) {
        console.error(e);
      }
    }
    const local = readJson<any[]>(LOCAL_QUOTES_KEY, []);
    return Array.isArray(local) ? local : [];
  };

  const handleUpsertQuote = async (input: {
    id?: string | null;
    client: string;
    phone?: string | null;
    address?: string | null;
    serviceName: string;
    quantity: number;
    unit?: string | null;
    unitPrice?: number | null;
    total?: number | null;
  }) => {
    const now = new Date().toISOString();
    const localRecord = {
      id: input.id ?? crypto.randomUUID(),
      client: input.client,
      phone: input.phone ?? null,
      address: input.address ?? null,
      serviceName: input.serviceName,
      quantity: input.quantity,
      unit: input.unit ?? null,
      unitPrice: input.unitPrice ?? null,
      total: input.total ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const existing = readJson<any[]>(LOCAL_QUOTES_KEY, []);
    writeJson(LOCAL_QUOTES_KEY, upsertById(Array.isArray(existing) ? existing : [], localRecord));

    if (isSupabaseConfigured && orgId) {
      try {
        const rec = await upsertServiceQuote(orgId, {
          id: localRecord.id,
          client: input.client,
          phone: input.phone ?? null,
          address: input.address ?? null,
          serviceName: input.serviceName,
          quantity: input.quantity,
          unit: input.unit ?? null,
          unitPrice: input.unitPrice ?? null,
          total: input.total ?? null,
        });

        // Remove any pending op for this id.
        const pending = readJson<any[]>(PENDING_QUOTES_KEY, []);
        writeJson(PENDING_QUOTES_KEY, (Array.isArray(pending) ? pending : []).filter((p) => !(p?.type === 'upsert' && p?.quote?.id === rec.id)));

        return {
          id: rec.id,
          client: rec.client,
          phone: rec.phone,
          address: rec.address,
          serviceName: rec.serviceName,
          quantity: rec.quantity,
          unit: rec.unit,
          unitPrice: rec.unitPrice,
          total: rec.total,
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt,
        };
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_QUOTES_KEY, []);
    const next = Array.isArray(pending) ? pending.filter((p) => !(p?.type === 'upsert' && p?.quote?.id === localRecord.id)) : [];
    next.push({ type: 'upsert', quote: { ...localRecord } });
    writeJson(PENDING_QUOTES_KEY, next);

    return localRecord;
  };

  const handleDeleteQuote = async (quoteId: string) => {
    if (!quoteId) return;
    const existing = readJson<any[]>(LOCAL_QUOTES_KEY, []);
    if (Array.isArray(existing)) {
      writeJson(LOCAL_QUOTES_KEY, existing.filter((q) => String(q?.id) !== String(quoteId)));
    }

    if (isSupabaseConfigured && orgId) {
      try {
        await deleteServiceQuote(orgId, quoteId);
        return;
      } catch (e) {
        console.error(e);
      }
    }

    const pending = readJson<any[]>(PENDING_QUOTES_KEY, []);
    const next = Array.isArray(pending) ? pending.filter((p) => !(p?.type === 'delete' && p?.id === quoteId)) : [];
    next.push({ type: 'delete', id: quoteId });
    writeJson(PENDING_QUOTES_KEY, next);
  };

  const handleLogin = async (email: string, password: string) => {
    const trimmedPassword = String(password || '').trim();
    if (!trimmedPassword) {
      const err = new Error('Contraseña requerida.');
      throw err;
    }

    const trimmedEmail = String(email || '').trim();
    const hasUserEmail = Boolean(trimmedEmail);

    const metaEnv = ((import.meta as any).env ?? {}) as Record<string, any>;
    const enableCloudLogin = String(metaEnv.VITE_ENABLE_CLOUD_LOGIN || '').trim().toLowerCase() === 'true';

    // Login 100% local por dispositivo, usando localStorage
    const existingPassword = localStorage.getItem(LOCAL_PASSWORD_KEY);
    if (!existingPassword) {
      // Primera vez en este dispositivo: registra la contraseña ingresada
      localStorage.setItem(LOCAL_PASSWORD_KEY, trimmedPassword);
    } else if (existingPassword !== trimmedPassword) {
      const err = new Error('Contraseña incorrecta para este dispositivo.');
      throw err;
    }

    // En este punto el login local fue exitoso
    setIsAuthenticated(true);
    setCurrentView('INICIO');

    // Local-only por defecto. Para habilitar sincronización/login cloud en Supabase,
    // defina VITE_ENABLE_CLOUD_LOGIN=true en build time.
    setCloudError(null);
    setOrgId(null);

    // Inicializa sesión de Supabase en segundo plano con una cuenta técnica fija
    if (isSupabaseConfigured && enableCloudLogin) {
      try {
        setCloudError(null);
        // Preferimos VITE_SUPABASE_EMAIL, pero si viene vacío usamos VITE_ADMIN_EMAIL
        const rawEmail = (metaEnv.VITE_SUPABASE_EMAIL || metaEnv.VITE_ADMIN_EMAIL) as
          | string
          | undefined;
        const serviceEmail = rawEmail && String(rawEmail).trim() ? String(rawEmail).trim() : undefined;
        const servicePassword = metaEnv.VITE_SUPABASE_PASSWORD as string | undefined;

        // GitHub Pages cannot safely embed service credentials (VITE_* are public).
        // If service creds exist (private hosting), use them; otherwise, fall back to user-provided email/password.
        if (serviceEmail && servicePassword) {
          await ensureSupabaseSession(serviceEmail, servicePassword);
        } else if (hasUserEmail) {
          await ensureSupabaseSession(trimmedEmail, trimmedPassword);
        } else {
          setCloudError(
            'Supabase está configurado (URL/ANON) pero no hay credenciales de inicio de sesión. Ingrese su correo en la pantalla de acceso para activar sincronización en la nube; si no, la app funcionará en modo local.'
          );
          setOrgId(null);
          return;
        }

        const resolvedOrgId = await getOrCreateOrgId('M&S Construcción');
        setOrgId(resolvedOrgId);
        await refreshProjects(resolvedOrgId);
        await Promise.all([
          syncOfflineProjects(resolvedOrgId),
          syncOfflineTransactions(resolvedOrgId),
          syncOfflineRequisitions(resolvedOrgId),
          syncOfflineEmployees(resolvedOrgId),
          syncOfflineBudgets(resolvedOrgId),
          syncOfflineProgress(resolvedOrgId),
          syncOfflineSuppliers(resolvedOrgId),
          syncOfflinePayRates(resolvedOrgId),
          syncOfflineEmployeeOverrides(resolvedOrgId),
          syncOfflineContracts(resolvedOrgId),
          syncOfflineQuotes(resolvedOrgId),
          syncOfflineAttendanceTokens(),
          syncOfflineAttendanceManual(resolvedOrgId),
          syncOfflineRequisitionMutations(resolvedOrgId),
        ]);
        await syncOfflineTransactions(resolvedOrgId);
      } catch (e: any) {
        console.error(e);
        const msg = e?.message || 'Error inicializando Supabase para datos en la nube. La app seguirá funcionando en modo local en este dispositivo.';
        setCloudError(msg);
      }
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured || !orgId) return;
    const onOnline = () => {
      void Promise.all([
        syncOfflineProjects(orgId),
        syncOfflineTransactions(orgId),
        syncOfflineRequisitions(orgId),
        syncOfflineEmployees(orgId),
        syncOfflineBudgets(orgId),
        syncOfflineProgress(orgId),
        syncOfflineSuppliers(orgId),
        syncOfflinePayRates(orgId),
        syncOfflineEmployeeOverrides(orgId),
        syncOfflineContracts(orgId),
        syncOfflineQuotes(orgId),
        syncOfflineAttendanceTokens(),
        syncOfflineAttendanceManual(orgId),
        syncOfflineRequisitionMutations(orgId),
      ]);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [orgId]);

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentView('WELCOME');
    setOrgId(null);
    setCloudError(null);
  };

  const handleQuickBuy = (data: RequisitionData) => {
    setRequisitionData(data);
    setCurrentView('COMPRAS');
  };

  const handleQuoteProject = (project: Project) => {
    setQuoteInitialData({
      clientName: project.clientName,
      address: project.location
    });
    setCurrentView('COTIZADOR');
  };

  // Public hash-based sub-apps (installable PWA views)
  if (/^#asistencia=/.test(hash)) {
    return <WorkerAttendance />;
  }
  if (/^#contract-intake=/.test(hash)) {
    return <ContractIntake />;
  }

  if (!isAuthenticated) {
    return <WelcomeScreen onLogin={handleLogin} />;
  }

  const NavItem = ({ view, icon: Icon, label }: { view: ViewState, icon: any, label: string }) => (
    <button
      onClick={() => {
        setCurrentView(view);
        setIsMobileMenuOpen(false);
        // Clear temp states when manually navigating
        if (view !== 'PRESUPUESTOS') setPreselectedProjectId('');
        if (view !== 'COMPRAS') setRequisitionData(null);
        if (view !== 'COTIZADOR') setQuoteInitialData(null);
      }}
      className={`flex items-center space-x-3 w-full p-3 rounded-lg transition-colors ${
        currentView === view 
          ? 'bg-mustard-500 text-navy-900 font-bold' 
          : 'text-gray-300 hover:bg-navy-800 hover:text-white'
      }`}
    >
      <Icon size={20} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-navy-900 text-white shadow-xl">
        <div className="p-6 border-b border-navy-800">
          <h1 className="text-xl font-bold text-mustard-500">M&S Construcción</h1>
          <p className="text-xs text-gray-400 mt-1 tracking-widest">EDIFICANDO EL FUTURO</p>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <NavItem view="INICIO" icon={Wallet} label="Inicio" />
          <NavItem view="DASHBOARD" icon={LayoutDashboard} label="Dashboard" />
          <NavItem view="PROYECTOS" icon={HardHat} label="Proyectos" />
          <NavItem view="PRESUPUESTOS" icon={FileText} label="Presupuestos" />
          <NavItem view="SEGUIMIENTO" icon={Activity} label="Seguimiento" />
          <NavItem view="COMPRAS" icon={ShoppingCart} label="Compras" />
          <NavItem view="RRHH" icon={Users} label="Recursos Humanos" />
          <NavItem view="COTIZADOR" icon={Calculator} label="Cotizador Rápido" />
        </nav>
        <div className="p-4 border-t border-navy-800">
          <button onClick={handleLogout} className="flex items-center space-x-2 text-red-400 hover:text-red-300 w-full p-2">
            <LogOut size={18} />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 w-full bg-navy-900 text-white z-50 flex items-center justify-between p-4 shadow-md">
        <div>
          <h1 className="font-bold text-mustard-500">M&S</h1>
          <div className="text-[10px] text-gray-200 mt-1">
            {cloudError
              ? 'Error nube · usando modo local'
              : !isSupabaseConfigured
                ? 'Modo local (sin nube)'
                : orgId
                  ? 'Nube sincronizada'
                  : 'Conectando con nube...'}
          </div>
        </div>
        <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-navy-900 z-40 pt-16 px-4 md:hidden">
           <nav className="space-y-2">
            <NavItem view="INICIO" icon={Wallet} label="Inicio" />
            <NavItem view="DASHBOARD" icon={LayoutDashboard} label="Dashboard" />
            <NavItem view="PROYECTOS" icon={HardHat} label="Proyectos" />
            <NavItem view="PRESUPUESTOS" icon={FileText} label="Presupuestos" />
            <NavItem view="SEGUIMIENTO" icon={Activity} label="Seguimiento" />
            <NavItem view="COMPRAS" icon={ShoppingCart} label="Compras" />
            <NavItem view="RRHH" icon={Users} label="Recursos Humanos" />
            <NavItem view="COTIZADOR" icon={Calculator} label="Cotizador" />
            <button onClick={handleLogout} className="flex items-center space-x-3 w-full p-3 text-red-400 mt-4">
              <LogOut size={20} />
              <span>Salir</span>
            </button>
          </nav>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto md:pt-0 pt-16 relative">
        <div className="p-4 md:p-8 max-w-7xl mx-auto h-full">
          {cloudError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded">
              <strong>Error Supabase:</strong> {cloudError}
            </div>
          )}

          {/* Header with Date/Time for every view */}
          <header className="mb-6 flex justify-between items-center border-b pb-4">
             <div>
                <h2 className="text-2xl font-bold text-navy-900">
                  {currentView === 'INICIO' && 'Resumen Financiero'}
                  {currentView === 'DASHBOARD' && 'Tablero de Control'}
                  {currentView === 'PROYECTOS' && 'Gestión de Proyectos'}
                  {currentView === 'PRESUPUESTOS' && 'Análisis de Costos'}
                  {currentView === 'SEGUIMIENTO' && 'Avance Físico vs Financiero'}
                  {currentView === 'COMPRAS' && 'Logística y Proveedores'}
                  {currentView === 'RRHH' && 'Personal y Planillas'}
                  {currentView === 'COTIZADOR' && 'Cotización de Servicios'}
                </h2>
             </div>
             <div className="text-right hidden sm:block">
               <div className="text-sm font-semibold text-gray-600">
                 {new Date().toLocaleDateString('es-GT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
               </div>
               <div className="text-xs text-gray-500">
                 {new Date().toLocaleTimeString()}
               </div>
               <div className="mt-1">
                 {cloudError ? (
                   <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 border border-red-200">
                     Error nube · modo local
                   </span>
                 ) : !isSupabaseConfigured ? (
                   <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                     Modo local (sin nube)
                   </span>
                 ) : orgId ? (
                   <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-green-100 text-green-700 border border-green-200">
                     Nube sincronizada
                   </span>
                 ) : (
                   <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                     Conectando con nube...
                   </span>
                 )}
               </div>
             </div>
          </header>

          <div className="animate-fade-in min-h-[80vh]">
            {currentView === 'INICIO' && (
              <Inicio projects={projects} onViewChange={setCurrentView} onCreateTransaction={handleCreateTransaction} />
            )}
            {currentView === 'DASHBOARD' && (
              <Dashboard
                projects={projects}
                useCloud={isSupabaseConfigured && !!orgId}
                orgId={orgId}
              />
            )}
            {currentView === 'PROYECTOS' && (
              <Proyectos 
                projects={projects} 
                onCreateProject={handleCreateProject}
                onUpdateProject={handleUpdateProject}
                onDeleteProject={handleDeleteProject}
                onViewChange={setCurrentView}
                onSelectProject={setPreselectedProjectId}
                onQuoteProject={handleQuoteProject}
              />
            )}
            {currentView === 'PRESUPUESTOS' && (
              <Presupuestos 
                projects={projects} 
                initialProjectId={preselectedProjectId}
                syncVersion={syncVersion}
                onQuickBuy={handleQuickBuy}
                onLoadBudget={handleLoadBudget}
                onSaveBudget={handleSaveBudget}
                onImportMaterialPrices={handleImportMaterialPrices}
                onImportMaterialPricesText={handleImportMaterialPricesText}
                onSuggestLineFromCatalog={handleSuggestLineFromCatalog}
                onImportApuTemplates={handleImportApuTemplates}
                onImportApuTemplatesCsv={handleImportApuTemplatesCsv}
                onImportApuTemplatesCsvText={handleImportApuTemplatesCsvText}
              />
            )}
            {currentView === 'SEGUIMIENTO' && (
              <Seguimiento
                projects={projects}
                useCloud={isSupabaseConfigured && !!orgId}
                orgId={orgId}
                syncVersion={syncVersion}
                onLoadBudget={handleLoadBudget}
                onLoadProgress={handleLoadProgress}
                onSaveProgress={handleSaveProgress}
              />
            )}
            {currentView === 'COMPRAS' && (
              <Compras 
                projects={projects} 
                initialData={requisitionData}
                syncVersion={syncVersion}
                onCreateRequisition={handleCreateRequisition}
                onListRequisitions={handleListRequisitions}
                onUpdateRequisitionStatus={handleUpdateRequisitionStatus}
                onListRequisitionItems={handleListRequisitionItems}
                onSaveRequisitionActualCosts={handleSaveRequisitionActualCosts}
                canApproveRequisitions={isSupabaseConfigured && !!orgId}
                onListSuppliers={handleListSuppliers}
                onUpsertSupplier={handleUpsertSupplier}
                onDeleteSupplier={handleDeleteSupplier}
              />
            )}
            {currentView === 'RRHH' && (
              <RRHH
                projects={projects}
                syncVersion={syncVersion}
                isAdmin={isSupabaseConfigured && !!orgId}
                onListEmployees={handleListEmployees}
                onCreateEmployee={handleCreateEmployee}
                onListContracts={handleListContracts}
                onUpsertContract={handleUpsertContract}
                onListAttendance={handleListAttendance}
                onSetAttendanceToken={handleSetAttendanceToken}
                onLoadPayRates={handleLoadPayRates}
                onSavePayRates={handleSavePayRates}
                onLoadEmployeeRateOverrides={handleLoadEmployeeRateOverrides}
                onUpsertEmployeeRateOverride={handleUpsertEmployeeRateOverride}
                onDeleteEmployeeRateOverride={handleDeleteEmployeeRateOverride}
              />
            )}
            {currentView === 'COTIZADOR' && (
              <Cotizador 
                initialData={quoteInitialData} 
                syncVersion={syncVersion}
                onListQuotes={handleListQuotes}
                onUpsertQuote={handleUpsertQuote}
                onDeleteQuote={handleDeleteQuote}
              />
            )}
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;
