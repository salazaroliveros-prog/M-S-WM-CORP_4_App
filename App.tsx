import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Wallet, HardHat, FileText, Activity, ShoppingCart, Users, Calculator, LogOut, Menu, X, Lock, ShieldCheck } from 'lucide-react';
import { ViewState, Project, RequisitionData, QuoteInitialData } from './types';
import { isSupabaseConfigured, getSupabaseClient } from './lib/supabaseClient';
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

const App: React.FC = () => {
  const appIconUrl = `${import.meta.env.BASE_URL}icon-192.png`;
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
      id: String(input.id ?? crypto.randomUUID()),
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
        () => {
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

  const handleCreateProject = async (partial: Partial<Project>) => {
    if (!useCloud || !orgId) {
      const newProject: Project = {
        id: crypto.randomUUID(),
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
          indirectPct: String(cached.indirectPct ?? '35'),
          lines: cached.lines,
        };
      }
      return null;
    };

    if (!useCloud || !orgId) {
      return readLocal();
    }

    try {
      const remote = await loadBudgetForProject(orgId, projectId);
      if (remote) {
        try {
          localStorage.setItem(
            budgetCacheKey(scopeKey, projectId),
            JSON.stringify({ ...remote, savedAt: new Date().toISOString() })
          );
        } catch {}
        return remote;
      }
      return readLocal();
    } catch {
      const local = readLocal();
      if (local) return local;
      throw new Error('Error cargando presupuesto (sin caché local disponible).');
    }
  };

  const handleSaveBudget = async (projectId: string, typology: string, indirectPct: string, lines: any[]) => {
    // Always cache locally (offline-first).
    try {
      localStorage.setItem(
        budgetCacheKey(scopeKey, projectId),
        JSON.stringify({ typology, indirectPct, lines, savedAt: new Date().toISOString() })
      );
    } catch {
      // ignore
    }

    if (!useCloud || !orgId) return;
    try {
      await saveBudgetForProject(orgId, projectId, typology, indirectPct, lines as any);
    } catch (e: any) {
      throw new Error(`Guardado local OK, pero falló Supabase: ${e?.message || 'error desconocido'}`);
    }
  };

  const handleLoadProgress = async (projectId: string) => {
    const readLocal = () => {
      const cached =
        safeJsonParse<any>(localStorage.getItem(progressCacheKey(scopeKey, projectId))) ??
        safeJsonParse<any>(localStorage.getItem(progressCompatKey(projectId)));
      if (cached && Array.isArray(cached.lines)) return cached;
      return null;
    };

    if (!useCloud || !orgId) return readLocal();

    try {
      const remote = await loadProgressForProject(orgId, projectId);
      if (remote) {
        try {
          localStorage.setItem(progressCompatKey(projectId), JSON.stringify(remote));
          localStorage.setItem(progressCacheKey(scopeKey, projectId), JSON.stringify(remote));
        } catch {}
        return remote;
      }
      return readLocal();
    } catch {
      const local = readLocal();
      if (local) return local;
      throw new Error('Error cargando avance (sin caché local disponible).');
    }
  };

  const handleSaveProgress = async (projectId: string, payload: any) => {
    // Always cache locally so offline mode works.
    try {
      localStorage.setItem(progressCompatKey(projectId), JSON.stringify(payload));
      localStorage.setItem(progressCacheKey(scopeKey, projectId), JSON.stringify(payload));
    } catch {
      // ignore
    }

    if (!useCloud || !orgId) return;
    try {
      await saveProgressForProject(orgId, projectId, payload);
    } catch (e: any) {
      throw new Error(`Avance guardado local, pero falló Supabase: ${e?.message || 'error desconocido'}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Compras: suppliers CRUD (cloud only)
  // ---------------------------------------------------------------------------

  const handleListSuppliers = async () => {
    if (!useCloud || !orgId) return null;
    const rows = await dbListSuppliers(orgId, 200);
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      whatsapp: s.whatsapp,
      defaultNoteTemplate: s.defaultNoteTemplate,
      termsTemplate: s.termsTemplate,
    }));
  };

  const handleUpsertSupplier = async (input: { id?: string | null; name: string; whatsapp?: string | null; phone?: string | null; defaultNoteTemplate?: string | null; termsTemplate?: string | null }) => {
    if (!useCloud || !orgId) return null;
    const row = await dbUpsertSupplier(orgId, {
      id: input.id ?? null,
      name: input.name,
      whatsapp: input.whatsapp ?? null,
      phone: input.phone ?? null,
      defaultNoteTemplate: input.defaultNoteTemplate ?? null,
      termsTemplate: input.termsTemplate ?? null,
    });
    return { id: row.id };
  };

  const handleDeleteSupplier = async (supplierId: string) => {
    if (!useCloud || !orgId) return;
    await dbDeleteSupplier(orgId, supplierId);
  };

  // ---------------------------------------------------------------------------
  // RRHH: pay rates + overrides (cloud only)
  // ---------------------------------------------------------------------------

  const handleLoadPayRates = async () => {
    if (!useCloud || !orgId) return null;
    return await dbListOrgPayRates(orgId);
  };

  const handleSavePayRates = async (payRates: Record<string, number>) => {
    if (!useCloud || !orgId) return;
    await dbUpsertOrgPayRates(orgId, payRates);
  };

  const handleLoadEmployeeRateOverrides = async () => {
    if (!useCloud || !orgId) return null;
    return await dbListEmployeeRateOverrides(orgId);
  };

  const handleUpsertEmployeeRateOverride = async (employeeId: string, dailyRate: number) => {
    if (!useCloud || !orgId) return;
    await dbUpsertEmployeeRateOverride(orgId, employeeId, dailyRate);
  };

  const handleDeleteEmployeeRateOverride = async (employeeId: string) => {
    if (!useCloud || !orgId) return;
    await dbDeleteEmployeeRateOverride(orgId, employeeId);
  };

  // ---------------------------------------------------------------------------
  // Cotizador: service quotes (offline-first)
  // ---------------------------------------------------------------------------

  const handleListServiceQuotes = async () => {
    const readLocal = () => {
      const cached = safeJsonParse<any[]>(localStorage.getItem(serviceQuotesCacheKey(scopeKey)));
      return Array.isArray(cached) ? cached : [];
    };

    if (!useCloud || !orgId) return readLocal();

    try {
      const remote = await dbListServiceQuotes(orgId, { limit: 50 });
      try {
        localStorage.setItem(serviceQuotesCacheKey(scopeKey), JSON.stringify(remote));
      } catch {}
      return remote;
    } catch {
      return readLocal();
    }
  };

  const handleUpsertServiceQuote = async (input: any) => {
    const localRows = (() => {
      const cached = safeJsonParse<any[]>(localStorage.getItem(serviceQuotesCacheKey(scopeKey)));
      return Array.isArray(cached) ? cached : [];
    })();

    const writeLocal = (rows: any[]) => {
      try {
        localStorage.setItem(serviceQuotesCacheKey(scopeKey), JSON.stringify(rows));
      } catch {}
    };

    if (useCloud && orgId) {
      const saved = await dbUpsertServiceQuote(orgId, input);
      writeLocal([saved, ...localRows.filter((q) => String(q?.id) !== String(saved.id))]);
      return saved;
    }

    const id = String(input?.id || crypto.randomUUID());
    const saved = {
      ...input,
      id,
      createdAt: input?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeLocal([saved, ...localRows.filter((q) => String(q?.id) !== id)]);
    return saved;
  };

  const handleDeleteServiceQuote = async (quoteId: string) => {
    const localRows = (() => {
      const cached = safeJsonParse<any[]>(localStorage.getItem(serviceQuotesCacheKey(scopeKey)));
      return Array.isArray(cached) ? cached : [];
    })();

    try {
      localStorage.setItem(
        serviceQuotesCacheKey(scopeKey),
        JSON.stringify(localRows.filter((q) => String(q?.id) !== String(quoteId)))
      );
    } catch {}

    if (!useCloud || !orgId) return;
    await dbDeleteServiceQuote(orgId, quoteId);
  };

  const handleImportMaterialPrices = async (input: { url: string; vendor: string; currency: string }) => {
    if (!useCloud || !orgId) throw new Error('Supabase no disponible (modo local).');
    return await importMaterialPricesFromCsvUrl(orgId, input);
  };

  const handleImportMaterialPricesText = async (input: { csvText: string; vendor: string; currency: string }) => {
    if (!useCloud || !orgId) throw new Error('Supabase no disponible (modo local).');
    return await importMaterialPricesFromCsvText(orgId, { ...input, sourceType: 'upload', sourceUrl: null });
  };

  const handleSuggestLineFromCatalog = async (typology: string, lineName: string) => {
    if (!useCloud || !orgId) return null;
    return await suggestLineFromApuCatalog(orgId, typology, lineName);
  };

  const handleImportApuTemplates = async (input: { url: string; source?: string; currency?: string }) => {
    if (!useCloud || !orgId) throw new Error('Supabase no disponible (modo local).');
    return await importApuTemplatesFromJsonUrl(orgId, input);
  };

  const handleImportApuTemplatesJsonText = async (input: { jsonText: string; source?: string; currency?: string; sourceUrl?: string | null }) => {
    if (!useCloud || !orgId) throw new Error('Supabase no disponible (modo local).');
    return await importApuTemplatesFromJsonText(orgId, input);
  };

  const handleImportApuTemplatesCsv = async (input: { url: string; source?: string; currency?: string }) => {
    if (!useCloud || !orgId) throw new Error('Supabase no disponible (modo local).');
    return await importApuTemplatesFromCsvUrl(orgId, input);
  };

  const handleImportApuTemplatesCsvText = async (input: { csvText: string; source?: string; currency?: string }) => {
    if (!useCloud || !orgId) throw new Error('Supabase no disponible (modo local).');
    return await importApuTemplatesFromCsvText(orgId, { ...input, sourceUrl: null });
  };

  const handleCreateRequisition = async (data: RequisitionData, supplierName: string | null) => {
    const localAdd = () => {
      const total = (data.items ?? []).reduce((sum, it: any) => {
        const qty = Number(it?.quantity ?? 0) || 0;
        return sum + Math.max(0, qty);
      }, 0);
      const row = {
        id: crypto.randomUUID(),
        projectId: data.projectId ?? null,
        requestedAt: new Date().toISOString(),
        supplierName: supplierName ?? null,
        supplierNote: data.sourceLineName ? `Renglón presupuesto: ${String(data.sourceLineName)}` : null,
        total,
        status: 'sent',
      };
      try {
        const raw = localStorage.getItem(requisitionsCacheKey(scopeKey));
        const prev = raw ? JSON.parse(raw) : [];
        const next = [row, ...(Array.isArray(prev) ? prev : [])].slice(0, 50);
        localStorage.setItem(requisitionsCacheKey(scopeKey), JSON.stringify(next));
      } catch {
        // ignore
      }
    };

    // Always record locally first.
    localAdd();

    if (!useCloud || !orgId) return;
    await createRequisition(
      orgId,
      data.projectId,
      supplierName,
      data.sourceBudgetLineId ?? null,
      data.items,
      'sent',
      data.sourceLineName ?? null
    );
  };

  const handleListRequisitions = async () => {
    const readLocal = () => {
      const cached = safeJsonParse<any[]>(localStorage.getItem(requisitionsCacheKey(scopeKey)));
      if (!cached || !Array.isArray(cached)) return [];
      return cached;
    };

    if (!useCloud || !orgId) return readLocal();

    try {
      const rows = await listRequisitions(orgId);
      try {
        localStorage.setItem(requisitionsCacheKey(scopeKey), JSON.stringify(rows));
      } catch {}
      return rows;
    } catch {
      return readLocal();
    }
  };

  const handleUpdateRequisitionStatus = async (
    requisitionId: string,
    status: 'sent' | 'confirmed' | 'received' | 'cancelled'
  ) => {
    try {
      const raw = localStorage.getItem(requisitionsCacheKey(scopeKey));
      const prev = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(prev)
        ? prev.map((r: any) => (String(r?.id) === String(requisitionId) ? { ...r, status } : r))
        : prev;
      localStorage.setItem(requisitionsCacheKey(scopeKey), JSON.stringify(next));
    } catch {
      // ignore
    }

    if (!useCloud || !orgId) return;
    await updateRequisitionStatus(orgId, requisitionId, status);
  };

  const handleListEmployees = async () => {
    if (!useCloud || !orgId) return null;
    return await listEmployees(orgId);
  };

  const handleCreateEmployee = async (input: any) => {
    if (!useCloud || !orgId) return null;
    return await createEmployee(orgId, input);
  };

  const handleListEmployeeContracts = async () => {
    if (!useCloud || !orgId) return null;
    return await listEmployeeContracts(orgId);
  };

  const handleUpsertEmployeeContract = async (input: any) => {
    if (!useCloud || !orgId) return null;
    return await upsertEmployeeContract(orgId, input);
  };

  const handleListAttendance = async (workDate: string) => {
    if (!useCloud || !orgId) return null;
    return await listAttendanceForDate(orgId, workDate);
  };

  const handleSetAttendanceToken = async (employeeId: string, token: string) => {
    if (!useCloud || !orgId) return;
    // orgId is validated inside the RPC by org membership.
    await setEmployeeAttendanceToken(employeeId, token);
  };

  const getCloudHelp = (message: string | null) => {
    const m = String(message || '');
    const lowered = m.toLowerCase();
    if (lowered.includes("schema cache") && (lowered.includes("org_members") || lowered.includes("could not find the table"))) {
      return {
        title: 'Faltan migraciones (esquema no inicializado)',
        detail:
          "Tu proyecto Supabase no tiene las tablas base (por ejemplo 'org_members'). En Supabase → SQL Editor, ejecuta primero supabase/migrations/20260204_init.sql y luego las migraciones del módulo que uses (progress_tracking, employee_contracts, attendance, etc.).",
      };
    }
    if (lowered.includes('anonymous sign-ins are disabled')) {
      return {
        title: 'Anonymous Sign-ins deshabilitado',
        detail:
          "La app intenta iniciar sesión anónima. Habilita Anonymous Sign-ins en Supabase Auth o cambia el método de login (email/password) para tu entorno.",
      };
    }
    if (lowered.includes('vite_supabase_url') || lowered.includes('vite_supabase_anon_key')) {
      return {
        title: 'Faltan variables de entorno',
        detail: 'Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en tu .env.local y reinicia el dev server.',
      };
    }
    if (lowered.includes('row-level security') && lowered.includes('organizations')) {
      return {
        title: 'RLS bloquea creación de la organización',
        detail:
          'Esto suele pasar cuando la petición llega sin sesión JWT (no está realmente logueado en Supabase). Abre “Diagnóstico” para ver si hay sesión; luego pulsa “Reintentar Supabase”. Si no puedes usar anonymous sign-in, crea un usuario de prueba (email/password) y usa el bootstrap SQL para asignarlo como owner de la org.',
      };
    }
    return {
      title: 'Error inicializando Supabase',
      detail: 'Revisa credenciales, Auth, RLS y que las migraciones estén aplicadas.',
    };
  };

  const initCloudStrict = async (): Promise<string> => {
    if (!isSupabaseConfigured) throw new Error('Supabase no configurado.');

    setIsCloudInitInFlight(true);
    try {
      setCloudError(null);
      setCloudMode('supabase');
      await ensureSupabaseSession();
      const resolvedOrgId = await getOrCreateOrgId();
      setOrgId(resolvedOrgId);
      try {
        const role = await getMyOrgRole(resolvedOrgId);
        setCanApproveRequisitions(role === 'owner' || role === 'admin');
      } catch {
        setCanApproveRequisitions(false);
      }
      await refreshProjects(resolvedOrgId);
      return resolvedOrgId;
    } catch (e: any) {
      console.error(e);
      setCloudError(e?.message || 'Error inicializando Supabase');
      setOrgId(null);
      setCanApproveRequisitions(false);
      setCloudMode('local');
      throw e;
    } finally {
      setIsCloudInitInFlight(false);
    }
  };

  const initCloud = async () => {
    if (!isSupabaseConfigured) return;
    try {
      await initCloudStrict();
    } catch {
      // keep UX: error banner + fallback to local
    }
  };

  const handleSyncCloud = async () => {
    await initCloudStrict();
  };

  const handleMigrateLocalToCloud = async (): Promise<{
    projects: number;
    budgets: number;
    progress: number;
    transactions: number;
    projectMap: Array<{ localId: string; localName: string; cloudId: string; cloudName: string }>;
  }> => {
    const resolvedOrgId = await initCloudStrict();

    const localScope = 'local';
    const localProjects = safeJsonParse<Project[]>(localStorage.getItem(projectsCacheKey(localScope))) ?? [];
    if (!Array.isArray(localProjects) || localProjects.length === 0) {
      throw new Error('No hay proyectos locales para migrar.');
    }

    const localToCloudProjectId = new Map<string, string>();
    const projectMap: Array<{ localId: string; localName: string; cloudId: string; cloudName: string }> = [];
    let createdProjects = 0;
    let migratedBudgets = 0;
    let migratedProgress = 0;
    let migratedTx = 0;

    for (const p of localProjects) {
      const created = await dbCreateProject(resolvedOrgId, {
        name: p.name,
        clientName: p.clientName,
        location: p.location,
        lot: p.lot,
        block: p.block,
        coordinates: p.coordinates,
        areaLand: p.areaLand,
        areaBuild: p.areaBuild,
        needs: p.needs,
        status: p.status,
        startDate: p.startDate,
        typology: p.typology,
        projectManager: p.projectManager,
      });
      createdProjects++;
      localToCloudProjectId.set(p.id, created.id);
      projectMap.push({ localId: p.id, localName: p.name, cloudId: created.id, cloudName: created.name });

      // Budget (offline-first cache)
      const cachedBudget = safeJsonParse<any>(localStorage.getItem(budgetCacheKey(localScope, p.id)));
      if (cachedBudget && Array.isArray(cachedBudget.lines)) {
        const typology = String(cachedBudget.typology ?? p.typology ?? '').trim() || String(p.typology || 'RESIDENCIAL');
        const indirectPct = String(cachedBudget.indirectPct ?? '35');
        const lines = (cachedBudget.lines as BudgetLine[]).map((l: any) => ({
          ...l,
          projectId: created.id,
        }));
        await saveBudgetForProject(resolvedOrgId, created.id, typology, indirectPct, lines);
        migratedBudgets++;
      }

      // Progress (offline-first cache)
      const cachedProgress =
        safeJsonParse<any>(localStorage.getItem(progressCacheKey(localScope, p.id))) ??
        safeJsonParse<any>(localStorage.getItem(progressCompatKey(p.id)));
      if (cachedProgress && Array.isArray(cachedProgress.lines)) {
        await saveProgressForProject(resolvedOrgId, created.id, {
          ...cachedProgress,
          projectId: created.id,
        });
        migratedProgress++;
      }
    }

    // Transactions (offline caches)
    const txLocal = safeJsonParse<any[]>(localStorage.getItem(txCacheKey(localScope))) ?? [];
    const txLegacy = safeJsonParse<any[]>(localStorage.getItem('transactions')) ?? [];
    const allTx = [...(Array.isArray(txLocal) ? txLocal : []), ...(Array.isArray(txLegacy) ? txLegacy : [])];
    const seen = new Set<string>();

    for (const raw of allTx) {
      const tx = normalizeLocalTransaction(raw);
      if (!tx) continue;
      const mappedProjectId = localToCloudProjectId.get(tx.projectId);
      if (!mappedProjectId) continue;

      const signature = `${tx.type}|${tx.date}|${tx.cost}|${tx.amount}|${tx.category}|${tx.description}|${tx.unit}|${mappedProjectId}`;
      if (seen.has(signature)) continue;
      seen.add(signature);

      await dbCreateTransaction(resolvedOrgId, { ...tx, projectId: mappedProjectId });
      migratedTx++;
    }

    // Refresh UI from cloud + bump modules
    await refreshProjects(resolvedOrgId);
    setCloudSyncVersion((v) => v + 1);

    return { projects: createdProjects, budgets: migratedBudgets, progress: migratedProgress, transactions: migratedTx, projectMap };
  };

  const handleLogin = () => {
    setIsAuthenticated(true);
    setCurrentView('INICIO'); // Default after login

    // Cloud init (Supabase) if configured
    if (isSupabaseConfigured) {
      initCloud();
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentView('WELCOME');
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

  if (!isAuthenticated) {
    if (isContractIntakeMode) return <ContractIntake />;
    if (isWorkerAttendanceMode) return <WorkerAttendance />;
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
          <div className="flex items-center gap-3">
            <img src={appIconUrl} alt="M&S" className="w-8 h-8" />
            <h1 className="text-xl font-bold text-mustard-500">M&S Construcción</h1>
          </div>
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
          <NavItem view="DIAGNOSTICO" icon={ShieldCheck} label="Diagnóstico" />
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
          <div className="flex items-center gap-2">
            <img src={appIconUrl} alt="M&S" className="w-6 h-6" />
            <h1 className="font-bold text-mustard-500">M&S</h1>
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
              <NavItem view="DIAGNOSTICO" icon={ShieldCheck} label="Diagnóstico" />
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
          {cloudError && !isCloudErrorDismissed && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div>
                    <strong>{getCloudHelp(cloudError).title}:</strong> {cloudError}
                  </div>
                  <div className="text-xs text-red-600 mt-1">{getCloudHelp(cloudError).detail}</div>
                  {!useCloud && (
                    <div className="text-xs text-red-600 mt-1">Modo local activo: puedes usar Proyectos/Dashboard con LocalStorage mientras preparas Supabase.</div>
                  )}
                </div>
                <button
                  className="text-xs px-2 py-1 rounded border border-red-200 bg-white hover:bg-red-100"
                  onClick={() => {
                    setIsCloudErrorDismissed(true);
                    try {
                      localStorage.setItem('cloudErrorDismissed', '1');
                    } catch {}
                  }}
                >
                  Ocultar
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className="text-xs px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                  onClick={initCloud}
                  disabled={isCloudInitInFlight}
                >
                  {isCloudInitInFlight ? 'Conectando…' : 'Reintentar Supabase'}
                </button>
                <button
                  className="text-xs px-3 py-1 rounded border border-red-200 bg-white hover:bg-red-100"
                  onClick={() => {
                    setCloudMode('local');
                    setOrgId(null);
                  }}
                >
                  Usar modo local
                </button>
              </div>
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
                  {currentView === 'DIAGNOSTICO' && 'Diagnóstico (Supabase)'}
                </h2>
             </div>
             <div className="text-right hidden sm:block">
               <div className="text-sm font-semibold text-gray-600">
                 {new Date().toLocaleDateString('es-GT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
               </div>
               <div className="text-xs text-gray-500">
                 {new Date().toLocaleTimeString()}
               </div>
             </div>
          </header>

          <div className="animate-fade-in min-h-[80vh]">
            {currentView === 'INICIO' && (
              <Inicio projects={projects} onViewChange={setCurrentView} onCreateTransaction={handleCreateTransaction} />
            )}
            {currentView === 'DASHBOARD' && <Dashboard projects={projects} useCloud={useCloud} orgId={orgId} />}
            {currentView === 'PROYECTOS' && (
              <Proyectos 
                projects={projects} 
                onCreateProject={handleCreateProject}
                onUpdateProject={handleUpdateProject}
                onDeleteProject={handleDeleteProject}
                onViewChange={setCurrentView}
                onSelectProject={setPreselectedProjectId}
                onQuoteProject={handleQuoteProject}
                onSyncCloud={isSupabaseConfigured ? handleSyncCloud : undefined}
                onMigrateLocalToCloud={isSupabaseConfigured ? handleMigrateLocalToCloud : undefined}
              />
            )}
            {currentView === 'PRESUPUESTOS' && (
              <Presupuestos 
                projects={projects} 
                initialProjectId={preselectedProjectId}
                syncVersion={cloudSyncVersion}
                onQuickBuy={handleQuickBuy}
                onLoadBudget={handleLoadBudget}
                onSaveBudget={handleSaveBudget}
                onImportMaterialPrices={handleImportMaterialPrices}
                onImportMaterialPricesText={handleImportMaterialPricesText}
                onSuggestLineFromCatalog={handleSuggestLineFromCatalog}
                onImportApuTemplates={handleImportApuTemplates}
                onImportApuTemplatesJsonText={handleImportApuTemplatesJsonText}
                onImportApuTemplatesCsv={handleImportApuTemplatesCsv}
                onImportApuTemplatesCsvText={handleImportApuTemplatesCsvText}
              />
            )}
            {currentView === 'SEGUIMIENTO' && (
              <Seguimiento
                projects={projects}
                useCloud={useCloud}
                orgId={orgId}
                syncVersion={cloudSyncVersion}
                onLoadBudget={handleLoadBudget}
                onLoadProgress={handleLoadProgress}
                onSaveProgress={handleSaveProgress}
              />
            )}
            {currentView === 'COMPRAS' && (
              <Compras 
                projects={projects} 
                initialData={requisitionData}
                syncVersion={cloudSyncVersion}
                onLoadBudget={handleLoadBudget}
                onCreateRequisition={handleCreateRequisition}
                onListRequisitions={handleListRequisitions}
                onUpdateRequisitionStatus={handleUpdateRequisitionStatus}
                canApproveRequisitions={canApproveRequisitions}
                onListSuppliers={handleListSuppliers}
                onUpsertSupplier={handleUpsertSupplier}
                onDeleteSupplier={handleDeleteSupplier}
              />
            )}
            {currentView === 'RRHH' && (
              <RRHH
                projects={projects}
                syncVersion={cloudSyncVersion}
                isAdmin={!useCloud || canApproveRequisitions}
                onListEmployees={handleListEmployees}
                onCreateEmployee={handleCreateEmployee}
                onListContracts={handleListEmployeeContracts}
                onUpsertContract={handleUpsertEmployeeContract}
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
                syncVersion={cloudSyncVersion}
                onListQuotes={handleListServiceQuotes}
                onUpsertQuote={handleUpsertServiceQuote}
                onDeleteQuote={handleDeleteServiceQuote}
              />
            )}
            {currentView === 'DIAGNOSTICO' && (
              <SupabaseDiagnostics orgId={orgId} enabled={isSupabaseConfigured} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;