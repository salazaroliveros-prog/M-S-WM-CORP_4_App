import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Wallet, HardHat, FileText, Activity, ShoppingCart, Users, Calculator, LogOut, Menu, X, Lock, ShieldCheck } from 'lucide-react';
import { ViewState, Project, RequisitionData, QuoteInitialData } from './types';
import { isSupabaseConfigured, getSupabaseClient } from './lib/supabaseClient';
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
  listEmployeeContracts,
  upsertEmployeeContract,
  listAttendanceForDate,
  setEmployeeAttendanceToken,
} from './lib/db';

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
  const appIconUrl = `${import.meta.env.BASE_URL}icon.svg`;
  const isContractIntakeMode = typeof window !== 'undefined' && String(window.location.hash || '').startsWith('#contract-intake=');
  const isWorkerAttendanceMode = typeof window !== 'undefined' && String(window.location.hash || '').startsWith('#asistencia=');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState<ViewState>('WELCOME');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [orgId, setOrgId] = useState<string | null>(null);
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
    if (!useCloud) {
      const savedProjects = localStorage.getItem('projects');
      if (savedProjects) {
        setProjects(JSON.parse(savedProjects));
      }
    }
  }, [useCloud]);

  // Save to LocalStorage
  useEffect(() => {
    if (!useCloud) {
      localStorage.setItem('projects', JSON.stringify(projects));
    }
  }, [projects, useCloud]);

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
    if (!useCloud || !orgId) {
      // Keep existing local behavior (Inicio already writes localStorage), so no-op here.
      return;
    }
    await dbCreateTransaction(orgId, tx);
  };

  const handleLoadBudget = async (projectId: string) => {
    if (!useCloud || !orgId) return null;
    return await loadBudgetForProject(orgId, projectId);
  };

  const handleSaveBudget = async (projectId: string, typology: string, indirectPct: string, lines: any[]) => {
    if (!useCloud || !orgId) return;
    await saveBudgetForProject(orgId, projectId, typology, indirectPct, lines as any);
  };

  const handleLoadProgress = async (projectId: string) => {
    if (!useCloud || !orgId) return null;
    return await loadProgressForProject(orgId, projectId);
  };

  const handleSaveProgress = async (projectId: string, payload: any) => {
    if (!useCloud || !orgId) return;
    await saveProgressForProject(orgId, projectId, payload);
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

  const handleImportApuTemplatesCsv = async (input: { url: string; source?: string; currency?: string }) => {
    if (!useCloud || !orgId) throw new Error('Supabase no disponible (modo local).');
    return await importApuTemplatesFromCsvUrl(orgId, input);
  };

  const handleImportApuTemplatesCsvText = async (input: { csvText: string; source?: string; currency?: string }) => {
    if (!useCloud || !orgId) throw new Error('Supabase no disponible (modo local).');
    return await importApuTemplatesFromCsvText(orgId, { ...input, sourceUrl: null });
  };

  const handleCreateRequisition = async (data: RequisitionData, supplierName: string | null) => {
    if (!useCloud || !orgId) return;
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
    if (!useCloud || !orgId) return [];
    return await listRequisitions(orgId);
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

  const initCloud = async () => {
    if (!isSupabaseConfigured) return;
    setIsCloudInitInFlight(true);
    try {
      setCloudError(null);
      setCloudMode('supabase');
      await ensureSupabaseSession();
      const resolvedOrgId = await getOrCreateOrgId();
      setOrgId(resolvedOrgId);
      await refreshProjects(resolvedOrgId);
    } catch (e: any) {
      console.error(e);
      setCloudError(e?.message || 'Error inicializando Supabase');
      setOrgId(null);
      setCloudMode('local');
    } finally {
      setIsCloudInitInFlight(false);
    }
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
                onLoadBudget={handleLoadBudget}
                onLoadProgress={handleLoadProgress}
                onSaveProgress={handleSaveProgress}
              />
            )}
            {currentView === 'COMPRAS' && (
              <Compras 
                projects={projects} 
                initialData={requisitionData}
                onLoadBudget={handleLoadBudget}
                onCreateRequisition={handleCreateRequisition}
                onListRequisitions={handleListRequisitions}
              />
            )}
            {currentView === 'RRHH' && (
              <RRHH
                projects={projects}
                onListEmployees={handleListEmployees}
                onCreateEmployee={handleCreateEmployee}
                onListContracts={handleListEmployeeContracts}
                onUpsertContract={handleUpsertEmployeeContract}
                onListAttendance={handleListAttendance}
                onSetAttendanceToken={handleSetAttendanceToken}
              />
            )}
            {currentView === 'COTIZADOR' && (
              <Cotizador 
                initialData={quoteInitialData} 
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