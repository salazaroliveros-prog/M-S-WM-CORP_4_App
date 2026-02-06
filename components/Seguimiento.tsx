import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BudgetLine, Project } from '../types';
import { CheckCircle, RefreshCw, Save } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import {
  addWorkingDaysInclusive,
  defaultWorkCalendarForYears,
  nextWorkingDay,
  parseIsoDateOnly,
  toIsoDateKey,
  workingDaysBetweenInclusive,
} from '../lib/calendar';

interface Props {
  projects: Project[];
  useCloud?: boolean;
  orgId?: string | null;
  onLoadBudget?: (projectId: string) => Promise<{ indirectPct: string; lines: BudgetLine[] } | null>;
  onLoadProgress?: (projectId: string) => Promise<ProjectProgressPayload | null>;
  onSaveProgress?: (projectId: string, payload: ProjectProgressPayload) => Promise<void>;
}

type ProgressStatus = { type: 'success' | 'error' | 'info'; message: string } | null;

export interface ProjectProgressLine {
  name: string;
  unit: string;
  plannedQty: number;
  completedQty: number;
  notes?: string;
}

export interface ProjectProgressPayload {
  projectId: string;
  updatedAt?: string;
  lines: ProjectProgressLine[];
}

interface ProgressLineState {
  key: string;
  name: string;
  unit: string;
  plannedQty: number;
  directCost: number;
  completedQty: number;
  notes: string;
}

type TxRow = {
  project_id: string | null;
  type: 'INGRESO' | 'GASTO' | string;
  cost: number;
  category: string | null;
  occurred_at: string;
};

type GanttTask = {
  key: string;
  name: string;
  unit: string;
  qty: number;
  durationDays: number;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  slackDays: number;
  isCritical: boolean;
  barLeftPct: number;
  barWidthPct: number;
};

const Seguimiento: React.FC<Props> = ({ projects, useCloud = false, orgId = null, onLoadBudget, onLoadProgress, onSaveProgress }) => {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [budgetIndirectPct, setBudgetIndirectPct] = useState<string>('0');
  const [progressLines, setProgressLines] = useState<ProgressLineState[]>([]);
  const [status, setStatus] = useState<ProgressStatus>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [summaryByProjectId, setSummaryByProjectId] = useState<Record<string, number>>({});
  const [plannedBudgetByProjectId, setPlannedBudgetByProjectId] = useState<Record<string, number>>({});
  const [projectSearch, setProjectSearch] = useState('');

  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);

  const allProjects = useMemo(() => projects.slice(), [projects]);
  const projectsByCreated = useMemo(() => projects.slice(), [projects]);
  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const activeProjects = useMemo(() => projects.filter(p => p.status === 'active'), [projects]);
  const filteredActiveProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return activeProjects;
    return activeProjects.filter((p) =>
      `${p.name} ${p.clientName} ${p.location}`.toLowerCase().includes(q)
    );
  }, [activeProjects, projectSearch]);

  const currency = useMemo(() => {
    try {
      return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ', maximumFractionDigits: 0 });
    } catch {
      return new Intl.NumberFormat('es', { style: 'currency', currency: 'GTQ', maximumFractionDigits: 0 });
    }
  }, []);

  const normalizeKey = (name: string) => {
    return String(name || '')
      .toLowerCase()
      .replace(/^[\s\d]+[\.|\)]\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const storageKey = (projectId: string) => `wm_progress_v1_${projectId}`;
  const selectedKey = () => 'wm_seguimiento_selected_project_v1';

  useEffect(() => {
    try {
      const saved = localStorage.getItem(selectedKey());
      if (saved && projects.some(p => p.id === saved)) {
        setSelectedProjectId(saved);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (selectedProjectId) localStorage.setItem(selectedKey(), selectedProjectId);
    } catch {
      // ignore
    }
  }, [selectedProjectId]);

  const loadProgressLocal = (projectId: string): ProjectProgressPayload | null => {
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      if (!raw) return null;
      return JSON.parse(raw) as ProjectProgressPayload;
    } catch {
      return null;
    }
  };

  const saveProgressLocal = (projectId: string, payload: ProjectProgressPayload) => {
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify({ ...payload, updatedAt: new Date().toISOString() }));
    } catch {
      // ignore
    }
  };

  const computeOverallPct = (lines: ProgressLineState[]) => {
    const weights = lines.map(l => ({ w: Math.max(0, Number(l.directCost) || 0), pct: l.plannedQty > 0 ? Math.min(1, Math.max(0, l.completedQty / l.plannedQty)) : 0 }));
    const sumW = weights.reduce((a, x) => a + x.w, 0);
    if (sumW > 0) return weights.reduce((a, x) => a + x.w * x.pct, 0) / sumW;
    if (lines.length === 0) return 0;
    return weights.reduce((a, x) => a + x.pct, 0) / lines.length;
  };

  const overallPct = useMemo(() => computeOverallPct(progressLines), [progressLines]);

  useEffect(() => {
    if (!selectedProjectId) {
      setBudgetLines([]);
      setBudgetIndirectPct('0');
      setProgressLines([]);
      setStatus(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setStatus({ type: 'info', message: 'Cargando renglones del presupuesto y avance...' });
      try {
        const budget = onLoadBudget ? await onLoadBudget(selectedProjectId) : null;
        if (cancelled) return;

        const loadedLines = budget?.lines ?? [];
        setBudgetLines(loadedLines);
        setBudgetIndirectPct(String(budget?.indirectPct ?? '0'));

        const remoteProgress = onLoadProgress ? await onLoadProgress(selectedProjectId) : null;
        const saved = remoteProgress ?? loadProgressLocal(selectedProjectId);

        const savedByKey = new Map<string, ProjectProgressLine>();
        for (const pl of saved?.lines ?? []) {
          savedByKey.set(normalizeKey(pl.name), pl);
        }

        let nextProgress: ProgressLineState[] = [];

        if (loadedLines.length > 0) {
          nextProgress = loadedLines.map((bl) => {
            const key = normalizeKey(bl.name);
            const prev = savedByKey.get(key);
            const plannedQty = Number(bl.quantity) || 0;
            const completedQty = Math.max(0, Math.min(plannedQty || Infinity, Number(prev?.completedQty ?? 0) || 0));
            return {
              key,
              name: bl.name,
              unit: bl.unit,
              plannedQty,
              directCost: Number(bl.directCost) || 0,
              completedQty,
              notes: String(prev?.notes ?? ''),
            };
          });
        } else if (saved?.lines?.length) {
          // Budget not available but progress was saved locally/cloud before.
          nextProgress = (saved.lines ?? []).map((pl) => {
            const key = normalizeKey(pl.name);
            const plannedQty = Number(pl.plannedQty) || 0;
            const completedQty = Math.max(0, Math.min(plannedQty || Infinity, Number(pl.completedQty ?? 0) || 0));
            return {
              key,
              name: pl.name,
              unit: pl.unit,
              plannedQty,
              directCost: 0,
              completedQty,
              notes: String(pl.notes ?? ''),
            };
          });
        }

        setProgressLines(nextProgress);

        if (loadedLines.length === 0 && !saved?.lines?.length) {
          setStatus({ type: 'info', message: 'No hay presupuesto guardado para este proyecto. Genere/guarde el presupuesto en Presupuestos.' });
        } else if (saved) {
          setStatus({ type: 'success', message: 'Avance cargado. Puede editar y guardar.' });
        } else {
          setStatus({ type: 'info', message: 'Sin avance registrado aún. Ingrese cantidades ejecutadas y guarde.' });
        }
      } catch (e: any) {
        if (cancelled) return;
        setStatus({ type: 'error', message: e?.message || 'Error cargando avance' });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, onLoadBudget, onLoadProgress]);

  const handleChangeCompleted = (key: string, value: number) => {
    setProgressLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const v = Number.isFinite(value) ? value : 0;
        const clamped = Math.max(0, Math.min(l.plannedQty || Infinity, v));
        return { ...l, completedQty: clamped };
      })
    );
  };

  const handleChangeNotes = (key: string, value: string) => {
    setProgressLines((prev) => prev.map((l) => (l.key === key ? { ...l, notes: value } : l)));
  };

  const handleSave = async () => {
    if (!selectedProjectId) {
      setStatus({ type: 'error', message: 'Seleccione un proyecto.' });
      return;
    }
    if (budgetLines.length === 0) {
      setStatus({ type: 'error', message: 'No hay presupuesto cargado para guardar avance.' });
      return;
    }

    const payload: ProjectProgressPayload = {
      projectId: selectedProjectId,
      updatedAt: new Date().toISOString(),
      lines: progressLines.map((l) => ({
        name: l.name,
        unit: l.unit,
        plannedQty: l.plannedQty,
        completedQty: l.completedQty,
        notes: l.notes?.trim() ? l.notes.trim() : undefined,
      })),
    };

    try {
      setIsLoading(true);
      setStatus({ type: 'info', message: 'Guardando avance...' });
      if (onSaveProgress) {
        await onSaveProgress(selectedProjectId, payload);
      } else {
        saveProgressLocal(selectedProjectId, payload);
      }
      setStatus({ type: 'success', message: 'Avance guardado.' });
      setSummaryByProjectId((prev) => ({ ...prev, [selectedProjectId]: computeOverallPct(progressLines) }));
    } catch (e: any) {
      setStatus({ type: 'error', message: e?.message || 'Error guardando avance' });
    } finally {
      setIsLoading(false);
    }
  };

  const sumPlannedBudget = (lines: BudgetLine[], indirectPctStr: string) => {
    const direct = (lines ?? []).reduce((a, l) => a + (Number(l.directCost) || 0), 0);
    const pct = Number(indirectPctStr) || 0;
    const factor = 1 + Math.max(0, pct) / 100;
    return Math.round(direct * factor);
  };

  const plannedBudgetSelected = useMemo(() => {
    if (!selectedProjectId) return 0;
    return sumPlannedBudget(budgetLines, budgetIndirectPct);
  }, [selectedProjectId, budgetLines, budgetIndirectPct]);

  const plannedBudgetGlobal = useMemo(() => {
    const ids = activeProjects.map((p) => p.id);
    if (ids.length === 0) return 0;
    return ids.reduce((a, id) => a + (Number(plannedBudgetByProjectId[id]) || 0), 0);
  }, [activeProjects, plannedBudgetByProjectId]);

  const inferExpenseGroup = (category: string | null | undefined, description: string | null | undefined) => {
    const text = `${category ?? ''} ${description ?? ''}`.toLowerCase();
    if (text.includes('material')) return 'Materiales';
    if (text.includes('mano de obra') || text.includes('labor') || text.includes('salario') || text.includes('planilla')) return 'Mano de Obra';
    if (text.includes('herramient') || text.includes('equipo') || text.includes('maquina') || text.includes('renta')) return 'Herr/Eq';
    if (text.includes('sub') && text.includes('contr')) return 'Sub-Contratos';
    if (text.includes('admin') || text.includes('oficina') || text.includes('servicio')) return 'Administrativos';
    if (text.includes('personal') || text.includes('viatico') || text.includes('viático') || text.includes('comida') || text.includes('gasolina')) return 'Personales';
    return 'Otros';
  };

  type CashLinePoint = { name: string; ingresos: number; gastos: number };
  type Metrics = {
    monthIncome: number;
    monthExpense: number;
    incomeTotal: number;
    expenseTotal: number;
    lineData: CashLinePoint[];
    expensePie: Array<{ name: string; value: number }>;
  };

  const computeMetrics = (rows: TxRow[]): Metrics => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthsBack = 5;

    const monthKeys: { key: string; label: string }[] = [];
    for (let i = monthsBack; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('es', { month: 'short' }).replace('.', '');
      monthKeys.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }

    const buckets = new Map<string, { ingresos: number; gastos: number }>();
    for (const m of monthKeys) buckets.set(m.key, { ingresos: 0, gastos: 0 });

    const pieBuckets = new Map<string, number>();
    for (const name of ['Materiales', 'Mano de Obra', 'Herr/Eq', 'Sub-Contratos', 'Administrativos', 'Personales', 'Otros']) {
      pieBuckets.set(name, 0);
    }

    let incomeTotal = 0;
    let expenseTotal = 0;
    for (const r of rows) {
      const type = String(r.type).toUpperCase();
      const cost = Number(r.cost ?? 0) || 0;
      const d = new Date(r.occurred_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const b = buckets.get(key);
      if (b) {
        if (type === 'INGRESO') b.ingresos += cost;
        else b.gastos += cost;
      }

      if (type === 'INGRESO') {
        incomeTotal += cost;
      } else {
        expenseTotal += cost;
        const group = inferExpenseGroup(r.category, null);
        pieBuckets.set(group, (pieBuckets.get(group) ?? 0) + cost);
      }
    }

    const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
    const monthBucket = buckets.get(monthKey) ?? { ingresos: 0, gastos: 0 };

    const lineData: CashLinePoint[] = monthKeys.map((m) => {
      const b = buckets.get(m.key) ?? { ingresos: 0, gastos: 0 };
      return { name: m.label, ingresos: Math.round(b.ingresos), gastos: Math.round(b.gastos) };
    });

    const expensePie = Array.from(pieBuckets.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .filter((x) => x.value > 0);

    return {
      monthIncome: Math.round(monthBucket.ingresos),
      monthExpense: Math.round(monthBucket.gastos),
      incomeTotal: Math.round(incomeTotal),
      expenseTotal: Math.round(expenseTotal),
      lineData,
      expensePie: expensePie.length ? expensePie : [{ name: 'Sin gastos', value: 1 }],
    };
  };

  const globalMetrics = useMemo(() => computeMetrics(transactions), [transactions]);
  const selectedProjectMetrics = useMemo(() => {
    if (!selectedProjectId) return null;
    const rows = transactions.filter((t) => String(t.project_id ?? '') === selectedProjectId);
    return computeMetrics(rows);
  }, [transactions, selectedProjectId]);

  const COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#7c3aed', '#64748b', '#111827'];

  const gantt = useMemo(() => {
    if (!selectedProjectId) return { tasks: [] as GanttTask[], start: null as string | null, end: null as string | null };
    if (!selectedProject) return { tasks: [] as GanttTask[], start: null as string | null, end: null as string | null };
    if (!budgetLines || budgetLines.length === 0) return { tasks: [] as GanttTask[], start: null as string | null, end: null as string | null };

    const baseStart = parseIsoDateOnly(selectedProject.startDate) ?? new Date();

    // Estimate duration from "labor effort". We only have laborCost (Q/unit), so we treat laborCost*qty as a proxy.
    // Daily burn is a pragmatic default; can be refined later with crew/productivity models.
    const DAILY_LABOR_BURN_Q = 1800;

    // Pre-compute rough end year range to build holiday calendar.
    const years = new Set<number>();
    years.add(baseStart.getFullYear());
    years.add(baseStart.getFullYear() + 1);
    const cal = defaultWorkCalendarForYears(Array.from(years));

    // Sequential dependencies by budget line order (as displayed/saved).
    const rawTasks = budgetLines.map((bl, idx) => {
      const qty = Number(bl.quantity) || 0;
      const effortQ = Math.max(0, (Number(bl.laborCost) || 0) * Math.max(0, qty));
      const duration = Math.max(1, Math.round(effortQ > 0 ? effortQ / DAILY_LABOR_BURN_Q : 1));
      return {
        idx,
        key: `${idx}-${String(bl.id || bl.name)}`,
        name: String(bl.name || ''),
        unit: String(bl.unit || ''),
        qty,
        durationDays: duration,
      };
    });

    let cursor = nextWorkingDay(baseStart, cal);
    const scheduled: Array<Omit<GanttTask, 'slackDays' | 'isCritical' | 'barLeftPct' | 'barWidthPct'>> = [];
    for (const t of rawTasks) {
      const start = nextWorkingDay(cursor, cal);
      const end = addWorkingDaysInclusive(start, t.durationDays, cal);
      scheduled.push({
        key: t.key,
        name: t.name,
        unit: t.unit,
        qty: t.qty,
        durationDays: t.durationDays,
        start: toIsoDateKey(start),
        end: toIsoDateKey(end),
      });
      cursor = new Date(end);
      cursor.setDate(cursor.getDate() + 1);
    }

    const projectStart = scheduled[0]?.start ?? toIsoDateKey(baseStart);
    const projectEnd = scheduled[scheduled.length - 1]?.end ?? projectStart;

    const startDate = parseIsoDateOnly(projectStart) ?? baseStart;
    const endDate = parseIsoDateOnly(projectEnd) ?? baseStart;
    const totalWorking = Math.max(1, workingDaysBetweenInclusive(startDate, endDate, cal));

    // With sequential dependencies, slack is 0 and the critical path includes all tasks.
    const tasks: GanttTask[] = scheduled.map((t) => {
      const tStart = parseIsoDateOnly(t.start) ?? startDate;
      const tEnd = parseIsoDateOnly(t.end) ?? endDate;
      const left = workingDaysBetweenInclusive(startDate, tStart, cal) - 1;
      const width = workingDaysBetweenInclusive(tStart, tEnd, cal);
      const barLeftPct = Math.max(0, Math.min(100, (left / totalWorking) * 100));
      const barWidthPct = Math.max(0.5, Math.min(100, (width / totalWorking) * 100));
      return {
        ...t,
        slackDays: 0,
        isCritical: true,
        barLeftPct,
        barWidthPct,
      };
    });

    return { tasks, start: projectStart, end: projectEnd };
  }, [selectedProjectId, selectedProject, budgetLines]);

  const loadTransactions = async () => {
    setMetricsError(null);
    try {
      const now = new Date();
      const monthsBack = 11;
      const rangeStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
      const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      if (useCloud && orgId && isSupabaseConfigured) {
        const supabase = getSupabaseClient();
        const res = await supabase
          .from('transactions')
          .select('project_id,type,cost,category,occurred_at')
          .eq('org_id', orgId)
          .gte('occurred_at', rangeStart.toISOString())
          .lt('occurred_at', rangeEnd.toISOString())
          .order('occurred_at', { ascending: true });
        if (res.error) throw res.error;
        const rows: TxRow[] = (res.data ?? []).map((r: any) => ({
          project_id: r.project_id ?? null,
          type: r.type,
          cost: Number(r.cost ?? 0) || 0,
          category: r.category ?? null,
          occurred_at: String(r.occurred_at),
        }));
        setTransactions(rows);
        return;
      }

      // Local fallback
      const raw = localStorage.getItem('transactions');
      const txs: any[] = raw ? JSON.parse(raw) : [];
      const rows: TxRow[] = txs.map((t) => ({
        project_id: t.projectId ?? null,
        type: t.type,
        cost: Number(t.cost ?? t.amount ?? 0) || 0,
        category: t.category ?? null,
        occurred_at: String(t.date ?? new Date().toISOString()),
      }));
      setTransactions(rows);
    } catch (e: any) {
      console.error(e);
      setMetricsError(e?.message || 'Error cargando transacciones para gráficas');
      setTransactions([]);
    }
  };

  // Auto-load transaction metrics and keep fresh via Realtime if available.
  useEffect(() => {
    loadTransactions();

    if (!useCloud || !orgId || !isSupabaseConfigured) return;

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`seguimiento-tx:${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `org_id=eq.${orgId}` },
        () => {
          if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
          refreshTimer.current = window.setTimeout(() => {
            loadTransactions();
          }, 400);
        }
      )
      .subscribe();

    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCloud, orgId]);

  const loadSummary = async () => {
    const ids = activeProjects.map(p => p.id);
    if (ids.length === 0) return;
    setIsLoading(true);
    setStatus({ type: 'info', message: 'Cargando resumen de avances...' });
    try {
      const next: Record<string, number> = {};
      const planned: Record<string, number> = {};
      for (const id of ids) {
        const budget = onLoadBudget ? await onLoadBudget(id) : null;
        const remoteProgress = onLoadProgress ? await onLoadProgress(id) : null;
        const saved = remoteProgress ?? loadProgressLocal(id);
        const savedByKey = new Map<string, ProjectProgressLine>();
        for (const pl of saved?.lines ?? []) savedByKey.set(normalizeKey(pl.name), pl);

        const budgetLines = budget?.lines ?? [];
        let merged: ProgressLineState[] = [];
        if (budgetLines.length > 0) {
          merged = budgetLines.map((bl) => {
            const key = normalizeKey(bl.name);
            const prev = savedByKey.get(key);
            const plannedQty = Number(bl.quantity) || 0;
            const completedQty = Math.max(0, Math.min(plannedQty || Infinity, Number(prev?.completedQty ?? 0) || 0));
            return {
              key,
              name: bl.name,
              unit: bl.unit,
              plannedQty,
              directCost: Number(bl.directCost) || 0,
              completedQty,
              notes: String(prev?.notes ?? ''),
            };
          });
        } else if (saved?.lines?.length) {
          merged = (saved.lines ?? []).map((pl) => ({
            key: normalizeKey(pl.name),
            name: pl.name,
            unit: pl.unit,
            plannedQty: Number(pl.plannedQty) || 0,
            directCost: 0,
            completedQty: Number(pl.completedQty) || 0,
            notes: String(pl.notes ?? ''),
          }));
        }

        next[id] = computeOverallPct(merged);

        const plannedBudget = budget?.lines?.length ? sumPlannedBudget(budget.lines, String(budget.indirectPct ?? '0')) : 0;
        planned[id] = plannedBudget;
      }
      setSummaryByProjectId(next);
      setPlannedBudgetByProjectId(planned);
      setStatus({ type: 'success', message: 'Resumen actualizado.' });
    } catch (e: any) {
      setStatus({ type: 'error', message: e?.message || 'Error cargando resumen' });
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-load summary when opening Seguimiento (for global view)
  useEffect(() => {
    if (activeProjects.length === 0) return;
    // Only auto-refresh when in global view.
    if (!selectedProjectId) {
      loadSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjects.length]);

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <label htmlFor="seguimiento-project" className="font-bold">Seleccionar Proyecto:</label>
            <select
              id="seguimiento-project"
              className="border p-2 rounded"
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              title="Seleccionar proyecto"
            >
              <option value="">Vista General (Todos)</option>
              {projectsByCreated.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadSummary}
              disabled={isLoading}
              className="px-4 py-2 bg-white border border-gray-300 rounded font-bold hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
              title="Cargar resumen de avances de proyectos activos"
            >
              <RefreshCw size={16} />
              Resumen
            </button>
            {selectedProjectId && (
              <button
                onClick={handleSave}
                disabled={isLoading}
                className="px-4 py-2 bg-navy-900 text-white rounded font-bold hover:bg-navy-800 flex items-center gap-2 disabled:opacity-50"
                title="Guardar avance"
              >
                <Save size={16} />
                Guardar
              </button>
            )}
          </div>
        </div>

        {status && (
          <div className={`mt-3 p-3 text-sm rounded border flex items-center gap-2 ${
            status.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
            status.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
            'bg-blue-50 border-blue-200 text-blue-800'
          }`}>
            {status.type === 'success' ? <CheckCircle size={16} /> : <RefreshCw size={16} />}
            <span>{status.message}</span>
          </div>
        )}
      </div>

      {!selectedProjectId && (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-lg font-bold text-navy-900">Proyectos Activos</h3>
            <div className="text-sm text-gray-500">Seleccione un proyecto para ver gráficas y editar avance por renglón.</div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500">Avance físico promedio (activos)</div>
              <div className="text-2xl font-extrabold text-navy-900">
                {(() => {
                  const vals = activeProjects.map((p) => summaryByProjectId[p.id]).filter((x) => Number.isFinite(x));
                  if (!vals.length) return '—';
                  const avg = vals.reduce((a, x) => a + (x as number), 0) / vals.length;
                  return `${Math.round(avg * 100)}%`;
                })()}
              </div>
              <div className="text-xs text-gray-500 mt-1">(usa Resumen para actualizar)</div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500">Ingresos (mes)</div>
              <div className="text-2xl font-extrabold text-navy-900">{currency.format(globalMetrics.monthIncome)}</div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500">Gastos (mes)</div>
              <div className="text-2xl font-extrabold text-navy-900">{currency.format(globalMetrics.monthExpense)}</div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500">Presupuesto planificado (activos)</div>
              <div className="text-2xl font-extrabold text-navy-900">{plannedBudgetGlobal ? currency.format(plannedBudgetGlobal) : '—'}</div>
            </div>
          </div>

          {metricsError && (
            <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded">
              {metricsError}
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="font-bold text-gray-700 mb-2">Ingresos vs Gastos (6 meses, global)</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={globalMetrics.lineData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(v: any) => currency.format(Number(v) || 0)} />
                    <Legend />
                    <Line type="monotone" dataKey="ingresos" stroke="#22c55e" strokeWidth={3} />
                    <Line type="monotone" dataKey="gastos" stroke="#ef4444" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="font-bold text-gray-700 mb-2">¿En qué se gasta? (global)</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={globalMetrics.expensePie} dataKey="value" nameKey="name" outerRadius={90} label>
                      {globalMetrics.expensePie.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => currency.format(Number(v) || 0)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="font-bold text-gray-700">Listado (activos)</div>
            <input
              type="text"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Buscar por proyecto, cliente o ubicación…"
              className="w-full md:w-96 p-2 border rounded"
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-700 font-bold">
                <tr>
                  <th className="p-3 text-left">Proyecto</th>
                  <th className="p-3 text-left">Cliente</th>
                  <th className="p-3 text-right">Avance</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredActiveProjects.map((p) => {
                  const pct = summaryByProjectId[p.id];
                  const pctLabel = Number.isFinite(pct) ? `${Math.round(pct * 100)}%` : '—';
                  const barPct = Number.isFinite(pct) ? Math.round(pct * 100) : 0;
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="p-3 font-semibold text-navy-900">{p.name}</td>
                      <td className="p-3 text-gray-600">{p.clientName}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <progress
                            className="w-40 h-2.5"
                            value={barPct}
                            max={100}
                            aria-label={`Avance de ${p.name}`}
                            title={`Avance: ${pctLabel}`}
                          />
                          <div className="font-bold">{pctLabel}</div>
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setSelectedProjectId(p.id)}
                          className="px-3 py-1 bg-navy-900 text-white rounded font-bold hover:bg-navy-800"
                        >
                          Abrir
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredActiveProjects.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-gray-500">No hay proyectos.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedProjectId && selectedProject && (
        <div className="space-y-6">
          <div className="bg-white p-4 rounded-xl shadow border border-gray-200">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="text-xs text-gray-500">Avance físico (ponderado)</div>
                <div className="text-2xl font-extrabold text-navy-900">{Math.round(overallPct * 100)}%</div>
                <progress className="w-full h-2.5 mt-2" value={Math.round(overallPct * 100)} max={100} />
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="text-xs text-gray-500">Presupuesto planificado</div>
                <div className="text-2xl font-extrabold text-navy-900">{plannedBudgetSelected ? currency.format(plannedBudgetSelected) : '—'}</div>
                <div className="text-xs text-gray-500 mt-1">Indirectos: {String(budgetIndirectPct || '0')}%</div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="text-xs text-gray-500">Gastos (mes)</div>
                <div className="text-2xl font-extrabold text-navy-900">{currency.format(selectedProjectMetrics?.monthExpense ?? 0)}</div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="text-xs text-gray-500">Ingresos (mes)</div>
                <div className="text-2xl font-extrabold text-navy-900">{currency.format(selectedProjectMetrics?.monthIncome ?? 0)}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-4 rounded-xl shadow border border-gray-200">
              <div className="font-bold text-gray-700 mb-2">Ingresos vs Gastos (6 meses, proyecto)</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={selectedProjectMetrics?.lineData ?? []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(v: any) => currency.format(Number(v) || 0)} />
                    <Legend />
                    <Line type="monotone" dataKey="ingresos" stroke="#22c55e" strokeWidth={3} />
                    <Line type="monotone" dataKey="gastos" stroke="#ef4444" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow border border-gray-200">
              <div className="font-bold text-gray-700 mb-2">¿En qué se gasta? (proyecto)</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={selectedProjectMetrics?.expensePie ?? [{ name: 'Sin gastos', value: 1 }]} dataKey="value" nameKey="name" outerRadius={90} label>
                      {(selectedProjectMetrics?.expensePie ?? [{ name: 'Sin gastos', value: 1 }]).map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => currency.format(Number(v) || 0)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="p-4 bg-navy-900 text-white flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs text-gray-300">Seguimiento por Renglón</div>
              <h3 className="text-lg font-bold">{selectedProject.name}</h3>
              <div className="text-xs text-gray-200">Cliente: {selectedProject.clientName} · Tipología: {selectedProject.typology}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-300">Avance global (ponderado)</div>
              <div className="text-2xl font-extrabold">{Math.round(overallPct * 100)}%</div>
              <progress
                className="w-56 h-2.5 mt-1"
                value={Math.round(overallPct * 100)}
                max={100}
                aria-label="Avance global"
                title={`Avance global: ${Math.round(overallPct * 100)}%`}
              />
            </div>
          </div>

          <div className="p-4 border-b border-gray-200">
            <div className="font-bold text-gray-700 mb-2">Planificado vs Ejecutado (cantidades, top renglones)</div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={progressLines
                    .slice()
                    .sort((a, b) => (Number(b.directCost) || 0) - (Number(a.directCost) || 0))
                    .slice(0, 12)
                    .map((l) => ({
                      name: l.name.length > 18 ? `${l.name.slice(0, 18)}…` : l.name,
                      plan: Math.round(Number(l.plannedQty) || 0),
                      ejec: Math.round(Number(l.completedQty) || 0),
                    }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" interval={0} angle={-15} textAnchor="end" height={60} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="plan" fill="#64748b" name="Planificado" />
                  <Bar dataKey="ejec" fill="#0ea5e9" name="Ejecutado" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="p-4">
            {progressLines.length === 0 ? (
              <div className="text-gray-500">No hay renglones cargados.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700 font-bold">
                    <tr>
                      <th className="p-3 text-left">Renglón</th>
                      <th className="p-3 text-center">Unidad</th>
                      <th className="p-3 text-right">Cantidad Presup.</th>
                      <th className="p-3 text-right">Cantidad Ejecutada</th>
                      <th className="p-3 text-right">%</th>
                      <th className="p-3">Avance</th>
                      <th className="p-3 text-left">Notas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {progressLines.map((l) => {
                      const pct = l.plannedQty > 0 ? Math.min(1, Math.max(0, l.completedQty / l.plannedQty)) : 0;
                      const pct100 = Math.round(pct * 100);
                      return (
                        <tr key={l.key} className="hover:bg-gray-50">
                          <td className="p-3 font-medium text-navy-900">{l.name}</td>
                          <td className="p-3 text-center text-gray-600">{l.unit}</td>
                          <td className="p-3 text-right font-mono">{l.plannedQty.toFixed(2)}</td>
                          <td className="p-3 text-right">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={Number.isFinite(l.completedQty) ? l.completedQty : 0}
                              onChange={(e) => handleChangeCompleted(l.key, parseFloat(e.target.value) || 0)}
                              className="w-28 p-2 border rounded text-right focus:ring-mustard-500 focus:border-mustard-500"
                              placeholder="0.00"
                              aria-label={`Cantidad ejecutada: ${l.name}`}
                              title={`Cantidad ejecutada (${l.unit})`}
                            />
                          </td>
                          <td className="p-3 text-right font-bold">{pct100}%</td>
                          <td className="p-3">
                            <progress
                              className="w-40 h-2.5"
                              value={pct100}
                              max={100}
                              aria-label={`Avance: ${l.name}`}
                              title={`${pct100}%`}
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={l.notes}
                              onChange={(e) => handleChangeNotes(l.key, e.target.value)}
                              className="w-full p-2 border rounded focus:ring-mustard-500 focus:border-mustard-500"
                              placeholder="(Opcional)"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {selectedProject && (
        <div className="bg-white p-6 rounded-xl shadow-md">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="font-bold text-navy-900">Cronograma (Gantt) por renglón</div>
              <div className="text-xs text-gray-500">
                Basado en renglones del presupuesto. Calendario: Lun–Sáb (Domingo no laborable) + feriados (por año) + Semana Santa.
              </div>
            </div>
            {gantt.start && gantt.end && (
              <div className="text-xs text-gray-600">
                <div><span className="font-semibold">Inicio:</span> {gantt.start}</div>
                <div><span className="font-semibold">Fin:</span> {gantt.end}</div>
              </div>
            )}
          </div>

          {gantt.tasks.length === 0 ? (
            <div className="text-sm text-gray-500">
              No hay renglones de presupuesto para generar el Gantt. Guarde el presupuesto en Presupuestos.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded border overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 text-xs text-gray-600 grid grid-cols-12 gap-2">
                  <div className="col-span-5 font-semibold">Renglón</div>
                  <div className="col-span-2 font-semibold">Duración</div>
                  <div className="col-span-2 font-semibold">Inicio</div>
                  <div className="col-span-2 font-semibold">Fin</div>
                  <div className="col-span-1 font-semibold text-right">Holg.</div>
                </div>
                {gantt.tasks.map((t) => (
                  <div key={t.key} className="px-3 py-2 border-t grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <div className="text-sm font-semibold text-navy-900">
                        {t.name}
                        {t.isCritical ? (
                          <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700">CRÍTICO</span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-gray-500">{t.qty ? `${Math.round(t.qty * 1000) / 1000} ${t.unit}` : t.unit}</div>
                      <div className="mt-2 h-2 bg-gray-100 rounded relative overflow-hidden">
                        <div
                          className={t.isCritical ? 'absolute top-0 h-2 bg-navy-900 rounded' : 'absolute top-0 h-2 bg-mustard-500 rounded'}
                          style={{ left: `${t.barLeftPct}%`, width: `${t.barWidthPct}%` }}
                        />
                      </div>
                    </div>
                    <div className="col-span-2 text-sm text-gray-700">{t.durationDays} día(s)</div>
                    <div className="col-span-2 text-sm text-gray-700">{t.start}</div>
                    <div className="col-span-2 text-sm text-gray-700">{t.end}</div>
                    <div className="col-span-1 text-sm text-gray-700 text-right">{t.slackDays}</div>
                  </div>
                ))}
              </div>

              <div className="text-xs text-gray-500">
                Ruta crítica: dependencias secuenciales según el orden del presupuesto (holgura = 0). Para holguras reales se requieren dependencias/actividades paralelas definidas.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Seguimiento;