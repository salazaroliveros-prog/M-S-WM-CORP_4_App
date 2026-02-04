import React, { useEffect, useMemo, useState } from 'react';
import { BudgetLine, Project } from '../types';
import { CheckCircle, RefreshCw, Save } from 'lucide-react';

interface Props {
  projects: Project[];
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

const Seguimiento: React.FC<Props> = ({ projects, onLoadBudget, onLoadProgress, onSaveProgress }) => {
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [progressLines, setProgressLines] = useState<ProgressLineState[]>([]);
  const [status, setStatus] = useState<ProgressStatus>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [summaryByProjectId, setSummaryByProjectId] = useState<Record<string, number>>({});

  const allProjects = useMemo(() => projects.slice(), [projects]);
  const projectsByCreated = useMemo(() => projects.slice(), [projects]);
  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

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

  const loadSummary = async () => {
    const ids = allProjects.map(p => p.id);
    if (ids.length === 0) return;
    setIsLoading(true);
    setStatus({ type: 'info', message: 'Cargando resumen de avances...' });
    try {
      const next: Record<string, number> = {};
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
      }
      setSummaryByProjectId(next);
      setStatus({ type: 'success', message: 'Resumen actualizado.' });
    } catch (e: any) {
      setStatus({ type: 'error', message: e?.message || 'Error cargando resumen' });
    } finally {
      setIsLoading(false);
    }
  };

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
            <div className="text-sm text-gray-500">Seleccione un proyecto para ingresar avance por renglón.</div>
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
                {allProjects.map((p) => {
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

                {allProjects.length === 0 && (
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
      )}
    </div>
  );
};

export default Seguimiento;