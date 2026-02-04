import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Wallet, HardHat, FileText, Activity, ShoppingCart, Users, Calculator, LogOut, Menu, X, Lock, ShieldCheck } from 'lucide-react';
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
      // Keep existing local behavior (Inicio already writes localStorage), so no-op here.
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
    if (!isSupabaseConfigured || !orgId) return;
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
    if (!isSupabaseConfigured || !orgId) return [];
    return await listRequisitions(orgId);
  };

  const handleListEmployees = async () => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await listEmployees(orgId);
  };

  const handleCreateEmployee = async (input: any) => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await createEmployee(orgId, input);
  };

  const handleListEmployeeContracts = async () => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await listEmployeeContracts(orgId);
  };

  const handleUpsertEmployeeContract = async (input: any) => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await upsertEmployeeContract(orgId, input);
  };

  const handleListAttendance = async (workDate: string) => {
    if (!isSupabaseConfigured || !orgId) return null;
    return await listAttendanceForDate(orgId, workDate);
  };

  const handleSetAttendanceToken = async (employeeId: string, token: string) => {
    if (!isSupabaseConfigured || !orgId) return;
    // orgId is validated inside the RPC by org membership.
    await setEmployeeAttendanceToken(employeeId, token);
  };

  const handleLogin = () => {
    setIsAuthenticated(true);
    setCurrentView('INICIO'); // Default after login

    // Cloud init (Supabase) if configured
    if (isSupabaseConfigured) {
      (async () => {
        try {
          setCloudError(null);
          await ensureSupabaseSession();
          const resolvedOrgId = await getOrCreateOrgId('M&S Construcción');
          setOrgId(resolvedOrgId);
          await refreshProjects(resolvedOrgId);
        } catch (e: any) {
          console.error(e);
          setCloudError(e?.message || 'Error inicializando Supabase');
        }
      })();
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
          {cloudError && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded">
              <strong>Error Supabase:</strong> {cloudError}
              <div className="text-xs text-red-600 mt-1">
                Configure <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> o habilite Anonymous Sign-ins.
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
            {currentView === 'DASHBOARD' && <Dashboard projects={projects} />}
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