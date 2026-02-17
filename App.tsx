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

... (file truncated)