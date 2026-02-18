import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Wallet, HardHat, FileText, Activity, ShoppingCart, Users, Calculator, LogOut, Menu, X, Lock } from 'lucide-react';
import { ViewState, Project, RequisitionData, QuoteInitialData } from './types';
import { isSupabaseConfigured } from './lib/supabaseClient';
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

const LOCAL_PASSWORD_KEY = 'ms_local_admin_password_v1';
const LOCAL_TRANSACTIONS_KEY = 'transactions';
const PENDING_TRANSACTIONS_KEY = 'wm_pending_transactions_v1';
const LOCAL_REQUISITIONS_KEY = 'wm_offline_requisitions_v1';
const PENDING_REQUISITIONS_KEY = 'wm_pending_requisitions_v1';
const LOCAL_EMPLOYEES_KEY = 'wm_offline_employees_v1';
const PENDING_EMPLOYEES_KEY = 'wm_pending_employees_v1';

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

const syncOfflineRequisitions = async (targetOrgId: string) => {
  try {
    const raw = localStorage.getItem(PENDING_REQUISITIONS_KEY);
    const pending: any[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(pending) || pending.length === 0) return;

    const stillPending: any[] = [];

    for (const entry of pending) {
      try {
        const { projectId, supplierName, sourceBudgetLineId, items, sourceLineName } = entry || {};
        if (!projectId || !Array.isArray(items) || items.length === 0) {
          continue;
        }
        await createRequisition(
          targetOrgId,
          projectId,
          supplierName ?? null,
          sourceBudgetLineId ?? null,
          items,
          'sent',
          sourceLineName ?? null
        );
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

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>('WELCOME');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);

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
    if (!isSupabaseConfigured) {
      const savedProjects = localStorage.getItem('projects');
      if (savedProjects) {
        setProjects(JSON.parse(savedProjects));
      }
    }
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    if (!isSupabaseConfigured) {
      localStorage.setItem('projects', JSON.stringify(projects));
    }
  }, [projects]);

  const refreshProjects = async (targetOrgId: string) => {
    const next = await listProjects(targetOrgId);
    setProjects(next);
  };

  const handleCreateProject = async (partial: Partial<Project>) => {
    if (!isSupabaseConfigured || !orgId) {
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
    if (!isSupabaseConfigured || !orgId) {
      setProjects(prev => prev.map(p => (p.id === projectId ? ({ ...p, ...patch } as Project) : p)));
      return;
    }

    const updated = await dbUpdateProject(orgId, projectId, patch);
    setProjects(prev => prev.map(p => (p.id === projectId ? updated : p)));
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!isSupabaseConfigured || !orgId) {
      setProjects(prev => prev.filter(p => p.id !== projectId));
      return;
    }

    await dbDeleteProject(orgId, projectId);
    setProjects(prev => prev.filter(p => p.id !== projectId));
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
    if (!isSupabaseConfigured || !orgId) return null;
    return await loadBudgetForProject(orgId, projectId);
  };

  const handleSaveBudget = async (projectId: string, typology: string, indirectPct: string, lines: any[]) => {
    if (!isSupabaseConfigured || !orgId) return;
    await saveBudgetForProject(orgId, projectId, typology, indirectPct, lines as any);
  };

  const handleLoadProgress = async (projectId: string) => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await loadProgressForProject(orgId, projectId);
  };

  const handleSaveProgress = async (projectId: string, payload: any) => {
    if (!isSupabaseConfigured || !orgId) return;
    await saveProgressForProject(orgId, projectId, payload);
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
        const localReq = {
          id: crypto.randomUUID(),
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

        // Cola de sincronización
        try {
          const rawPending = localStorage.getItem(PENDING_REQUISITIONS_KEY);
          const pending: any[] = rawPending ? JSON.parse(rawPending) : [];
          pending.push({
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
    await createRequisition(
      orgId,
      data.projectId,
      supplierName,
      data.sourceBudgetLineId ?? null,
      data.items,
      'sent'
    );
  };

  const handleListRequisitions = async () => {
    if (!isSupabaseConfigured || !orgId) {
      try {
        const raw = localStorage.getItem(LOCAL_REQUISITIONS_KEY);
        const existing: any[] = raw ? JSON.parse(raw) : [];
        return existing;
      } catch (e) {
        console.error('Error leyendo requisiciones locales', e);
        return (
          <div>
            <main className="min-h-screen bg-gray-100">
              <div className="flex flex-col min-h-screen">
                {/* Global notifications panel, visible on all screens if orgId is set */}
                {orgId && (
                  <div style={{ position: 'fixed', top: 0, right: 0, zIndex: 1000, width: 350, maxHeight: '90vh', overflowY: 'auto', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', borderRadius: 8, margin: 12, padding: 12 }}>
                    <Notifications orgId={orgId} />
                  </div>
                )}
                <div className="flex-1">
                  {/* ...existing code... */}
                </div>
              </div>
            </main>
          </div>
        );
    await updateRequisitionStatus(orgId, requisitionId, status);
  };

  const handleListRequisitionItems = async (
    requisitionId: string
  ): Promise<Array<{ id: string; name: string; unit: string; quantity: number; unitPrice: number | null; actualUnitCost: number | null }> | null> => {
    if (!isSupabaseConfigured || !orgId) return null;
    const rows = await listRequisitionItems(orgId, requisitionId);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      actualUnitCost: r.actualUnitCost,
    }));
  };

  const handleSaveRequisitionActualCosts = async (
    requisitionId: string,
    updates: Array<{ id: string; actualUnitCost: number | null }>
  ) => {
    if (!isSupabaseConfigured || !orgId) return;
    await setRequisitionItemsActualUnitCosts(orgId, requisitionId, updates);
  };

  const handleListSuppliers = async () => {
    if (!isSupabaseConfigured || !orgId) return null;
    const rows = await listSuppliers(orgId, 100);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      whatsapp: r.whatsapp,
      phone: r.phone,
      defaultNoteTemplate: r.defaultNoteTemplate,
      termsTemplate: r.termsTemplate,
    }));
  };

  const handleUpsertSupplier = async (input: {
    id?: string | null;
    name: string;
    whatsapp?: string | null;
    phone?: string | null;
    defaultNoteTemplate?: string | null;
    termsTemplate?: string | null;
  }): Promise<{ id: string } | null> => {
    if (!isSupabaseConfigured || !orgId) return null;
    const rec = await upsertSupplier(orgId, {
      id: input.id ?? undefined,
      name: input.name,
      whatsapp: input.whatsapp ?? null,
      phone: input.phone ?? null,
      defaultNoteTemplate: input.defaultNoteTemplate ?? null,
      termsTemplate: input.termsTemplate ?? null,
      email: null,
      notes: null,
    });
    return { id: rec.id };
  };

  const handleDeleteSupplier = async (supplierId: string) => {
    if (!isSupabaseConfigured || !orgId) return;
    await deleteSupplier(orgId, supplierId);
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
    if (!isSupabaseConfigured || !orgId) return null;
    return await listOrgPayRates(orgId);
  };

  const handleSavePayRates = async (payRates: Record<string, number>) => {
    if (!isSupabaseConfigured || !orgId) return;
    await upsertOrgPayRates(orgId, payRates);
  };

  const handleLoadEmployeeRateOverrides = async (): Promise<Record<string, number> | null> => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await listEmployeeRateOverrides(orgId);
  };

  const handleUpsertEmployeeRateOverride = async (employeeId: string, dailyRate: number) => {
    if (!isSupabaseConfigured || !orgId) return;
    await upsertEmployeeRateOverride(orgId, employeeId, dailyRate);
  };

  const handleDeleteEmployeeRateOverride = async (employeeId: string) => {
    if (!isSupabaseConfigured || !orgId) return;
    await deleteEmployeeRateOverride(orgId, employeeId);
  };

  const handleListContracts = async (): Promise<any[] | null> => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await listEmployeeContracts(orgId, 50);
  };

  const handleUpsertContract = async (input: any): Promise<any> => {
    if (!isSupabaseConfigured || !orgId) return input;
    return await upsertEmployeeContract(orgId, input);
  };

  const handleListAttendance = async (workDate: string): Promise<any[] | null> => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await listAttendanceForDate(orgId, workDate);
  };

  const handleSetAttendanceToken = async (employeeId: string, token: string) => {
    if (!isSupabaseConfigured || !orgId) return;
    await setEmployeeAttendanceToken(employeeId, token);
  };

  const handleListQuotes = async () => {
    if (!isSupabaseConfigured || !orgId) return [];
    const rows = await listServiceQuotes(orgId, { limit: 50 });
    return rows.map((r) => ({
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
    if (!isSupabaseConfigured || !orgId) {
      // En modo local, simplemente devolver un registro simulado para que el historial funcione en esta sesión.
      const now = new Date().toISOString();
      return {
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
    }

    const rec = await upsertServiceQuote(orgId, {
      id: input.id ?? null,
      client: input.client,
      phone: input.phone ?? null,
      address: input.address ?? null,
      serviceName: input.serviceName,
      quantity: input.quantity,
      unit: input.unit ?? null,
      unitPrice: input.unitPrice ?? null,
      total: input.total ?? null,
    });

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
  };

  const handleDeleteQuote = async (quoteId: string) => {
    if (!isSupabaseConfigured || !orgId) return;
    await deleteServiceQuote(orgId, quoteId);
  };

  const handleLogin = async (_email: string, password: string) => {
    const trimmedPassword = String(password || '').trim();
    if (!trimmedPassword) {
      const err = new Error('Contraseña requerida.');
      throw err;
    }

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

    // Inicializa sesión de Supabase en segundo plano con una cuenta técnica fija
    if (isSupabaseConfigured) {
      try {
        setCloudError(null);
        const metaEnv = ((import.meta as any).env ?? {}) as Record<string, any>;
        // Preferimos VITE_SUPABASE_EMAIL, pero si viene vacío usamos VITE_ADMIN_EMAIL
        const rawEmail = (metaEnv.VITE_SUPABASE_EMAIL || metaEnv.VITE_ADMIN_EMAIL) as
          | string
          | undefined;
        const serviceEmail = rawEmail && String(rawEmail).trim() ? String(rawEmail).trim() : undefined;
        const servicePassword = metaEnv.VITE_SUPABASE_PASSWORD as string | undefined;

        if (!serviceEmail || !servicePassword) {
          const missing: string[] = [];
          if (!serviceEmail) missing.push('VITE_SUPABASE_EMAIL o VITE_ADMIN_EMAIL');
          if (!servicePassword) missing.push('VITE_SUPABASE_PASSWORD');

          const detail =
            missing.length > 0
              ? ` Faltan variables: ${missing.join(', ')} (revise Secrets de GitHub o .env.local).`
              : '';

          // Sin credenciales de servicio: continuar solo en modo local y marcar claramente el estado.
          setCloudError(
            'Supabase configurado sin credenciales de servicio. La app funciona en modo local en este dispositivo.' +
              detail
          );
          setOrgId(null);
          return;
        }

        await ensureSupabaseSession(serviceEmail, servicePassword);
        const resolvedOrgId = await getOrCreateOrgId('M&S Construcción');
        setOrgId(resolvedOrgId);
        await refreshProjects(resolvedOrgId);
        await Promise.all([
          syncOfflineTransactions(resolvedOrgId),
          syncOfflineRequisitions(resolvedOrgId),
          syncOfflineEmployees(resolvedOrgId),
        ]);
        await syncOfflineTransactions(resolvedOrgId);
      } catch (e: any) {
        console.error(e);
        const msg = e?.message || 'Error inicializando Supabase para datos en la nube. La app seguirá funcionando en modo local en este dispositivo.';
        setCloudError(msg);
      }
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
                onLoadBudget={isSupabaseConfigured && orgId ? handleLoadBudget : undefined}
                onLoadProgress={isSupabaseConfigured && orgId ? handleLoadProgress : undefined}
                onSaveProgress={isSupabaseConfigured && orgId ? handleSaveProgress : undefined}
              />
            )}
            {currentView === 'COMPRAS' && (
              <Compras 
                projects={projects} 
                initialData={requisitionData}
                onCreateRequisition={handleCreateRequisition}
                onListRequisitions={handleListRequisitions}
                onUpdateRequisitionStatus={isSupabaseConfigured && orgId ? handleUpdateRequisitionStatus : undefined}
                onListRequisitionItems={isSupabaseConfigured && orgId ? handleListRequisitionItems : undefined}
                onSaveRequisitionActualCosts={isSupabaseConfigured && orgId ? handleSaveRequisitionActualCosts : undefined}
                canApproveRequisitions={isSupabaseConfigured && !!orgId}
                onListSuppliers={isSupabaseConfigured && orgId ? handleListSuppliers : undefined}
                onUpsertSupplier={isSupabaseConfigured && orgId ? handleUpsertSupplier : undefined}
                onDeleteSupplier={isSupabaseConfigured && orgId ? handleDeleteSupplier : undefined}
              />
            )}
            {currentView === 'RRHH' && (
              <RRHH
                projects={projects}
                syncVersion={0}
                isAdmin={isSupabaseConfigured && !!orgId}
                onListEmployees={handleListEmployees}
                onCreateEmployee={handleCreateEmployee}
                onListContracts={isSupabaseConfigured && orgId ? handleListContracts : undefined}
                onUpsertContract={isSupabaseConfigured && orgId ? handleUpsertContract : undefined}
                onListAttendance={isSupabaseConfigured && orgId ? handleListAttendance : undefined}
                onSetAttendanceToken={isSupabaseConfigured && orgId ? handleSetAttendanceToken : undefined}
                onLoadPayRates={isSupabaseConfigured && orgId ? handleLoadPayRates : undefined}
                onSavePayRates={isSupabaseConfigured && orgId ? handleSavePayRates : undefined}
                onLoadEmployeeRateOverrides={isSupabaseConfigured && orgId ? handleLoadEmployeeRateOverrides : undefined}
                onUpsertEmployeeRateOverride={isSupabaseConfigured && orgId ? handleUpsertEmployeeRateOverride : undefined}
                onDeleteEmployeeRateOverride={isSupabaseConfigured && orgId ? handleDeleteEmployeeRateOverride : undefined}
              />
            )}
            {currentView === 'COTIZADOR' && (
              <Cotizador 
                initialData={quoteInitialData} 
                syncVersion={0}
                onListQuotes={isSupabaseConfigured && orgId ? handleListQuotes : undefined}
                onUpsertQuote={isSupabaseConfigured && orgId ? handleUpsertQuote : undefined}
                onDeleteQuote={isSupabaseConfigured && orgId ? handleDeleteQuote : undefined}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
