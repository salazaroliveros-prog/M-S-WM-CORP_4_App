import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Wallet, HardHat, FileText, Activity, ShoppingCart, Users, Calculator, LogOut, Menu, X, Lock, ShieldCheck } from 'lucide-react';
import { ViewState, Project, RequisitionData, QuoteInitialData } from './types';
import { isSupabaseConfigured, getSupabaseClient, checkSupabaseHealth } from './lib/supabaseClient';
import {
  ensureSupabaseSession,
  getOrCreateOrgId,
  getMyOrgRole,
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
  importApuTemplatesFromJsonText,
  importApuTemplatesFromCsvUrl,
  importApuTemplatesFromCsvText,
  createRequisition,
  listRequisitions,
  updateRequisitionStatus,
  listRequisitionItems,
  setRequisitionItemsActualUnitCosts,
  listEmployees,
  createEmployee,
  listEmployeeContracts,
  upsertEmployeeContract,
  listAttendanceForDate,
  setEmployeeAttendanceToken,
  listSuppliers as dbListSuppliers,
  upsertSupplier as dbUpsertSupplier,
  deleteSupplier as dbDeleteSupplier,
  listOrgPayRates as dbListOrgPayRates,
  upsertOrgPayRates as dbUpsertOrgPayRates,
  listEmployeeRateOverrides as dbListEmployeeRateOverrides,
  upsertEmployeeRateOverride as dbUpsertEmployeeRateOverride,
  deleteEmployeeRateOverride as dbDeleteEmployeeRateOverride,
  listServiceQuotes as dbListServiceQuotes,
  upsertServiceQuote as dbUpsertServiceQuote,
  deleteServiceQuote as dbDeleteServiceQuote,
} from './lib/db';

import type { BudgetLine, Transaction } from './types';

// Components
import WelcomeScreen from './components/WelcomeScreen';
import Dashboard from './components/Dashboard';
import Inicio from './components/Inicio';
import Proyectos from './components/Proyectos';
import Presupuestos from './components/Presupuestos';
import Seguimiento from './components/Seguimiento';
import Compras from './components/Compras';
import RRHH from './components/RRHH';
import Cotizador from './components/Cotizador';
import SupabaseDiagnostics from './components/SupabaseDiagnostics';
import ContractIntake from './components/ContractIntake';
import WorkerAttendance from './components/WorkerAttendance';

// UUID helper: prefer crypto.randomUUID when available, otherwise fallback
function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
  } catch {}
  return 'id-' + Math.random().toString(36).slice(2, 10);
}

const App: React.FC = () => {
  const appIconUrl = `${import.meta.env.BASE_URL}header-logo.png`;
  const isContractIntakeMode = typeof window !== 'undefined' && String(window.location.hash || '').startsWith('#contract-intake=');
  const isWorkerAttendanceMode = typeof window !== 'undefined' && (
    String(window.location.hash || '').startsWith('#asistencia=') ||
    (() => {
      try {
        const cached = localStorage.getItem('wm_worker_attendance_token_last');
        return !!(cached && String(cached).trim());
      } catch {
        return false;
      }
    })()
  );
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>('WELCOME');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [canApproveRequisitions, setCanApproveRequisitions] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudMode, setCloudMode] = useState<'supabase' | 'local'>(() => (isSupabaseConfigured ? 'supabase' : 'local'));
  const [isCloudInitInFlight, setIsCloudInitInFlight] = useState(false);
  const [isCloudErrorDismissed, setIsCloudErrorDismissed] = useState(() => {
    try {
      return localStorage.getItem('cloudErrorDismissed') === '1';
    } catch {
      return false;
    }
  });
  const useCloud = cloudMode === 'supabase';

  const [cloudSyncVersion, setCloudSyncVersion] = useState(0);

  const scopeKey = useCloud && orgId ? `org_${orgId}` : 'local';
  const projectsCacheKey = (scope: string) => (scope === 'local' ? 'projects' : `wm_projects_v1_${scope}`);
  const lastCloudProjectsKey = () => 'wm_projects_v1_last_cloud';

  const budgetCacheKey = (scope: string, projectId: string) => `wm_budget_v1_${scope}_${projectId}`;
  const progressCacheKey = (scope: string, projectId: string) => `wm_progress_v1_${scope}_${projectId}`;
  const progressCompatKey = (projectId: string) => `wm_progress_v1_${projectId}`;
  const requisitionsCacheKey = (scope: string) => `wm_requisitions_v1_${scope}`;
  const txCacheKey = (scope: string) => `wm_transactions_v1_${scope}`;
  const serviceQuotesCacheKey = (scope: string) => `wm_service_quotes_v1_${scope}`;

  const safeJsonParse = <T,>(raw: string | null): T | null => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  const normalizeLocalTransaction = (input: any): Transaction | null => {
    if (!input) return null;
    const projectId = String(input.projectId ?? input.project_id ?? '').trim();
    const type = String(input.type ?? '').trim() as any;
    const date = String(input.date ?? input.occurred_at ?? '').trim();
    const cost = Number(input.cost ?? 0);
    if (!projectId) return null;
    if (type !== 'INGRESO' && type !== 'GASTO') return null;
    if (!date) return null;
    if (!Number.isFinite(cost)) return null;

    return {
      id: String(input.id ?? uuid()),
      projectId,
      type,
      description: String(input.description ?? ''),
      amount: Number(input.amount ?? 0) || 0,
      unit: String(input.unit ?? ''),
      cost,
      category: String(input.category ?? ''),
      date,
      provider: input.provider ? String(input.provider) : undefined,
      rentEndDate: input.rentEndDate ? String(input.rentEndDate) : (input.rent_end_date ? String(input.rent_end_date) : undefined),
    };
  };

  const projectFromDbRow = (row: any, prev?: Project): Project | null => {
    const id = row?.id;
    if (!id) return null;

    const pick = <T,>(value: T | undefined, fallback: T | undefined) => (value !== undefined ? value : fallback);

    const startRaw = pick<string | null>(row?.start_date, undefined);
    const startDate =
      startRaw !== undefined
        ? (startRaw ? new Date(startRaw).toISOString() : (prev?.startDate ?? new Date().toISOString()))
        : (prev?.startDate ?? new Date().toISOString());

    const areaLandRaw = pick<any>(row?.area_land, undefined);
    const areaBuildRaw = pick<any>(row?.area_build, undefined);

    return {
      id: String(id),
      name: pick<string>(row?.name, prev?.name) ?? '',
      clientName: pick<string>(row?.client_name, prev?.clientName) ?? '',
      location: pick<string>(row?.location, prev?.location) ?? '',
      lot: row?.lot !== undefined ? (row.lot ?? undefined) : prev?.lot,
      block: row?.block !== undefined ? (row.block ?? undefined) : prev?.block,
      coordinates: row?.coordinates !== undefined ? (row.coordinates ?? undefined) : prev?.coordinates,
      areaLand:
        areaLandRaw !== undefined ? (Number(areaLandRaw) || 0) : (prev?.areaLand ?? 0),
      areaBuild:
        areaBuildRaw !== undefined ? (Number(areaBuildRaw) || 0) : (prev?.areaBuild ?? 0),
      needs: pick<string>(row?.needs, prev?.needs) ?? '',
      status: pick<any>(row?.status, prev?.status) ?? 'standby',
      startDate,
      typology: pick<any>(row?.typology, prev?.typology),
      projectManager: pick<string>(row?.project_manager, prev?.projectManager) ?? '',
    } as Project;
  };

  // Global State (Mocking a database)
  const [projects, setProjects] = useState<Project[]>([]);
  
  // State to handle navigation from Proyectos to Presupuestos with a specific project selected
  const [preselectedProjectId, setPreselectedProjectId] = useState<string>('');

  // State to handle navigation from Presupuestos to Compras with requisition data
  const [requisitionData, setRequisitionData] = useState<RequisitionData | null>(null);

  // State to handle navigation from Proyectos to Cotizador with client data
  const [quoteInitialData, setQuoteInitialData] = useState<QuoteInitialData | null>(null);
  
  // Load cached projects (both local mode and cloud mode).
  useEffect(() => {
    try {
      const cached = safeJsonParse<Project[]>(localStorage.getItem(projectsCacheKey(scopeKey)));
      if (cached && Array.isArray(cached)) {
        setProjects(cached);
        return;
      }
      if (useCloud) {
        const last = safeJsonParse<Project[]>(localStorage.getItem(lastCloudProjectsKey()));
        if (last && Array.isArray(last)) setProjects(last);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  // Verify Supabase health on startup; if it fails, fall back to local mode.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isSupabaseConfigured) return;
    (async () => {
      try {
        const health = await checkSupabaseHealth();
        if (!health.ok) {
          console.warn('Supabase health check failed:', health.status, health.body);
          setCloudError(
            'No se pudo conectar a Supabase (health check falló). La app pasará a modo local. Revise VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.'
          );
          setCloudMode('local');
        }
      } catch (e) {
        console.warn('Error verificando Supabase:', e);
        setCloudError('Error verificando Supabase. La app pasará a modo local.');
        setCloudMode('local');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist projects to cache for offline/fast boot (even when using Supabase).
  useEffect(() => {
    try {
      localStorage.setItem(projectsCacheKey(scopeKey), JSON.stringify(projects));
      if (useCloud) localStorage.setItem(lastCloudProjectsKey(), JSON.stringify(projects));
    } catch {
      // ignore
    }
  }, [projects, scopeKey, useCloud]);

  const refreshProjects = async (targetOrgId: string) => {
    if (!useCloud) return;
    const next = await listProjects(targetOrgId);
    setProjects(next);
  };

  // Supabase Realtime: keep projects in sync across tabs/users.
  useEffect(() => {
    if (!useCloud || !orgId || !isSupabaseConfigured) return;

    const supabase = getSupabaseClient();
    let timer: number | null = null;

    const channel = supabase
      .channel(`app-projects:${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects', filter: `org_id=eq.${orgId}` },
        (payload) => {
          // Apply realtime payload immediately for better UX, then reconcile via a debounced refresh.
          try {
            const eventType = String((payload as any)?.eventType || (payload as any)?.event || '').toUpperCase();
            if (eventType === 'DELETE') {
              const deletedId = (payload as any)?.old?.id;
              if (deletedId) {
                setProjects((prev) => prev.filter((p) => p.id !== String(deletedId)));
              }
            } else {
              const row = (payload as any)?.new;
              const rowId = row?.id;
              if (rowId) {
                setProjects((prev) => {
                  const idx = prev.findIndex((p) => p.id === String(rowId));
                  const prior = idx >= 0 ? prev[idx] : undefined;
                  const mapped = projectFromDbRow(row, prior);
                  if (!mapped) return prev;
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = mapped;
                    return next;
                  }
                  return [mapped, ...prev];
                });
              }
            }
          } catch (e) {
            console.error(e);
          }

          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            refreshProjects(orgId).catch((e) => console.error(e));
          }, 350);
        }
      )
      .subscribe();

    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCloud, orgId]);

  // Supabase Realtime: global data sync bump for other modules.
  // This does not change UX; it only triggers background refreshes in modules.
  useEffect(() => {
    if (!useCloud || !orgId || !isSupabaseConfigured) return;

    const supabase = getSupabaseClient();
    let timer: number | null = null;

    const bump = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setCloudSyncVersion((v) => v + 1);
      }, 300);
    };

    const channel = supabase
      .channel(`app-sync:${orgId}`)
      // Presupuestos
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: `org_id=eq.${orgId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_lines', filter: `org_id=eq.${orgId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_line_materials', filter: `org_id=eq.${orgId}` }, bump)
      // Compras
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers', filter: `org_id=eq.${orgId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requisitions', filter: `org_id=eq.${orgId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requisition_items', filter: `org_id=eq.${orgId}` }, bump)
      // RRHH
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `org_id=eq.${orgId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_contracts', filter: `org_id=eq.${orgId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_pay_rates', filter: `org_id=eq.${orgId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_rate_overrides', filter: `org_id=eq.${orgId}` }, bump)
      // Cotizador
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_quotes', filter: `org_id=eq.${orgId}` }, bump)
      // Seguimiento
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_progress', filter: `org_id=eq.${orgId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_progress_lines', filter: `org_id=eq.${orgId}` }, bump)
      .subscribe();

    return () => {
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [useCloud, orgId]);

  // Cross-device freshness: when the tab becomes active again, force a background refresh.
  useEffect(() => {
    if (!useCloud || !orgId) return;

    let lastKick = 0;
    const kick = () => {
      const now = Date.now();
      if (now - lastKick < 800) return;
      lastKick = now;
      refreshProjects(orgId).catch((e) => console.error(e));
      setCloudSyncVersion((v) => v + 1);
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') kick();
    };

    window.addEventListener('focus', kick);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', kick);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCloud, orgId]);

  const handleCreateProject = async (partial: Partial<Project>) => {
    if (!useCloud || !orgId) {
      const newProject: Project = {
        id: uuid(),
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
      setProjects(prev => [newProject, ...prev]);
      return newProject;
    }

    const created = await dbCreateProject(orgId, partial);
    setProjects(prev => [created, ...prev]);
    return created;
  };

  const handleUpdateProject = async (projectId: string, patch: Partial<Project>) => {
    if (!useCloud || !orgId) {
      setProjects(prev => prev.map(p => (p.id === projectId ? ({ ...p, ...patch } as Project) : p)));
      return;
    }

    const updated = await dbUpdateProject(orgId, projectId, patch);
    setProjects(prev => prev.map(p => (p.id === projectId ? updated : p)));
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!useCloud || !orgId) {
      setProjects(prev => prev.filter(p => p.id !== projectId));
      return;
    }

    await dbDeleteProject(orgId, projectId);
    setProjects(prev => prev.filter(p => p.id !== projectId));
  };

  const handleCreateTransaction = async (tx: any) => {
    // Always persist locally so Dashboard/Seguimiento can work offline.
    try {
      const raw = localStorage.getItem('transactions');
      const prev = raw ? JSON.parse(raw) : [];
      localStorage.setItem('transactions', JSON.stringify([...(Array.isArray(prev) ? prev : []), tx]));
      const scopeRaw = localStorage.getItem(txCacheKey(scopeKey));
      const scopePrev = scopeRaw ? JSON.parse(scopeRaw) : [];
      localStorage.setItem(txCacheKey(scopeKey), JSON.stringify([...(Array.isArray(scopePrev) ? scopePrev : []), tx]));
    } catch {
      // ignore
    }

    if (!useCloud || !orgId) return;
    await dbCreateTransaction(orgId, tx);
  };

  const handleLoadBudget = async (projectId: string) => {
    const readLocal = () => {
      const cached = safeJsonParse<any>(localStorage.getItem(budgetCacheKey(scopeKey, projectId)));
      if (cached && Array.isArray(cached.lines)) {
        return {
          typology: typeof cached.typology === 'string' ? cached.typology : undefined,
... (file truncated by API for brevity)
