import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Project } from '../types';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { isSupabaseConfigured, getSupabaseClient } from '../lib/supabaseClient';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Props {
  projects: Project[];
  useCloud?: boolean;
  orgId?: string | null;
  onSyncNow?: () => Promise<void> | void;
}

const Dashboard: React.FC<Props> = ({ projects, useCloud = false, orgId = null, onSyncNow }) => {
  const activeProjects = projects.filter(p => p.status === 'active').length;

  const COLORS = ['#0A192F', '#E1AD01'];

  const currency = useMemo(() => {
    try {
      return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ', maximumFractionDigits: 0 });
    } catch {
      return new Intl.NumberFormat('es', { style: 'currency', currency: 'GTQ', maximumFractionDigits: 0 });
    }
  }, []);

  type LinePoint = { name: string; ingresos: number; gastos: number };

  const [lineData, setLineData] = useState<LinePoint[]>([]);
  const [monthIncome, setMonthIncome] = useState(0);
  const [monthExpense, setMonthExpense] = useState(0);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);  

  type TxRow = {
    id: string;
    project_id: string;
    type: string;
    cost: number;
    category: string;
    provider: string;
    occurred_at: string;
  };
  const txRowsRef = useRef<TxRow[]>([]);
  const txRangeRef = useRef<{ start: string; end: string } | null>(null);

  const [filterProjectId, setFilterProjectId] = useState<string>('all');  
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const buildRange = () => {
    const startRaw = String(dateFrom || '').trim();
    const endRaw = String(dateTo || '').trim();
    const start = startRaw ? new Date(`${startRaw}T00:00:00`) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = endRaw ? new Date(`${endRaw}T23:59:59`) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      const now = new Date();
      const rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { startIso: rangeStart.toISOString(), endIso: rangeEnd.toISOString() };
    }
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    return { startIso, endIso };
  };

  const computeMetricsFromRows = (rows: TxRow[], range: { start: string; end: string }) => {
    const start = new Date(range.start);
    const end = new Date(range.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setMonthIncome(0);
      setMonthExpense(0);
      setLineData([]);
      return;
    }

    const monthKeys: { key: string; label: string }[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor.getTime() <= endMonth.getTime() && monthKeys.length < 24) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      const label = cursor.toLocaleString('es', { month: 'short' }).replace('.', '');
      monthKeys.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1) });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const buckets = new Map<string, { ingresos: number; gastos: number }>();
    for (const m of monthKeys) buckets.set(m.key, { ingresos: 0, gastos: 0 });

    const accumulate = (type: string, cost: number, occurredAt: string) => {
      const d = new Date(occurredAt);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;  
      const b = buckets.get(key);
      if (!b) return;
      if (String(type).toUpperCase() === 'INGRESO') b.ingresos += cost;
      else b.gastos += cost;
    };

    let totalIncome = 0;
    let totalExpense = 0;
    for (const r of rows) {
      const v = Number(r.cost ?? 0) || 0;
      if (String(r.type).toUpperCase() === 'INGRESO') totalIncome += v;
      else totalExpense += v;
      accumulate(r.type, v, String(r.occurred_at));
    }
    setMonthIncome(totalIncome);
    setMonthExpense(totalExpense);

    const nextLine: LinePoint[] = monthKeys.map((m) => {
      const b = buckets.get(m.key) ?? { ingresos: 0, gastos: 0 };
      return { name: m.label, ingresos: Math.round(b.ingresos), gastos: Math.round(b.gastos) };
    });
    setLineData(nextLine);  
  };

  const filteredTxRows = useMemo(() => {
    const rows = txRowsRef.current;
    if (!rows || rows.length === 0) return [];
    const proj = filterProjectId === 'all' ? null : filterProjectId;
    const { startIso, endIso } = buildRange();
    const startT = new Date(startIso).getTime();
    const endT = new Date(endIso).getTime();
    return rows.filter((r) => {
      if (proj && String(r.project_id) !== proj) return false;
      const t = new Date(String(r.occurred_at)).getTime();
      if (Number.isNaN(t)) return false;
      return t >= startT && t <= endT;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterProjectId, dateFrom, dateTo, useCloud, orgId]);

  const chartByCategoryExpense = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredTxRows) {
      if (String(r.type).toUpperCase() !== 'GASTO') continue;
      const key = (r.category || 'Sin categoría').trim() || 'Sin categoría';
      map.set(key, (map.get(key) ?? 0) + (Number(r.cost) || 0));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredTxRows]);

  const chartByCategoryIncome = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredTxRows) {
      if (String(r.type).toUpperCase() !== 'INGRESO') continue;
      const key = (r.category || 'Sin categoría').trim() || 'Sin categoría';
      map.set(key, (map.get(key) ?? 0) + (Number(r.cost) || 0));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredTxRows]);

  const chartByProviderExpense = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredTxRows) {
      if (String(r.type).toUpperCase() !== 'GASTO') continue;
      const key = (r.provider || 'Sin proveedor').trim() || 'Sin proveedor';
      map.set(key, (map.get(key) ?? 0) + (Number(r.cost) || 0));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredTxRows]);

  const chartByProject = useMemo(() => {
    const nameById = new Map<string, string>();
    for (const p of projects) nameById.set(String(p.id), String(p.name ?? ''));

    const map = new Map<string, { ingresos: number; gastos: number }>();
    for (const r of filteredTxRows) {
      const pid = String(r.project_id || '');
      if (!pid) continue;
      const b = map.get(pid) ?? { ingresos: 0, gastos: 0 };
      if (String(r.type).toUpperCase() === 'INGRESO') b.ingresos += Number(r.cost) || 0;
      else b.gastos += Number(r.cost) || 0;
      map.set(pid, b);
    }

    return Array.from(map.entries())
      .map(([projectId, v]) => {
        const ingresos = Math.round(v.ingresos);
        const gastos = Math.round(v.gastos);
        const neto = ingresos - gastos;
        return {
          projectId,
          name: nameById.get(projectId) || projectId,
          ingresos,
          gastos,
          neto,
        };
      })
      .sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto))
      .slice(0, 8);
  }, [filteredTxRows, projects]);

  const chartCumulative = useMemo(() => {
    const rows = [...filteredTxRows].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
    let acc = 0;
    const out: Array<{ name: string; saldo: number }> = [];
    for (const r of rows) {
      const v = Number(r.cost) || 0;
      acc += String(r.type).toUpperCase() === 'INGRESO' ? v : -v;
      const d = new Date(String(r.occurred_at));
      const label = Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      out.push({ name: label, saldo: Math.round(acc) });
    }
    // Downsample to ~30 points for readability.
    if (out.length <= 30) return out;
    const step = Math.ceil(out.length / 30);
    return out.filter((_, idx) => idx % step === 0 || idx === out.length - 1);
  }, [filteredTxRows]);

  const chartDailyCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredTxRows) {
      const d = new Date(String(r.occurred_at));
      if (Number.isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const rows = Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([iso, value]) => {
        const [yyyy, mm, dd] = iso.split('-');
        const name = dd && mm ? `${dd}/${mm}` : iso;
        return { name, value };
      });
    if (rows.length <= 30) return rows;
    const step = Math.ceil(rows.length / 30);
    return rows.filter((_, idx) => idx % step === 0 || idx === rows.length - 1);
  }, [filteredTxRows]);

  const chartDailyFlow = useMemo(() => {
    const map = new Map<string, { ingresos: number; gastos: number }>();
    for (const r of filteredTxRows) {
      const d = new Date(String(r.occurred_at));
      if (Number.isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      const b = map.get(key) ?? { ingresos: 0, gastos: 0 };
      const v = Number(r.cost) || 0;
      if (String(r.type).toUpperCase() === 'INGRESO') b.ingresos += v;
      else b.gastos += v;
      map.set(key, b);
    }
    const rows = Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([iso, v]) => {
        const [yyyy, mm, dd] = iso.split('-');
        const name = dd && mm ? `${dd}/${mm}` : iso;
        return { name, ingresos: Math.round(v.ingresos), gastos: Math.round(v.gastos) };
      });
    if (rows.length <= 30) return rows;
    const step = Math.ceil(rows.length / 30);
    return rows.filter((_, idx) => idx % step === 0 || idx === rows.length - 1);
  }, [filteredTxRows]);

  const pieData = useMemo(() => {
    const labelFor = (t: Project['typology']) => {
      switch (t) {
        case 'RESIDENCIAL':
          return 'Residencial';
        case 'COMERCIAL':
          return 'Comercial';
        case 'INDUSTRIAL':
          return 'Industrial';
        case 'PUBLICA':
          return 'Pública';
        case 'CIVIL':
          return 'Civil';
        default:
          return String(t);
      }
    };

    const counts = new Map<string, number>();
    for (const p of projects) {
      const key = labelFor(p.typology);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const rows = Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    if (rows.length === 0) {
      return [{ name: 'Sin proyectos', value: 1 }];
    }

    return rows;
  }, [projects]);

  const loadMetrics = async () => {
    setMetricsError(null);

    const { startIso: rangeStartIso, endIso: rangeEndIso } = buildRange();
    txRangeRef.current = { start: rangeStartIso, end: rangeEndIso };

    try {  
      if (useCloud && orgId && isSupabaseConfigured) {
        const supabase = getSupabaseClient();
        let q = supabase
          .from('transactions')
          .select('id, type, cost, occurred_at, category, provider, project_id')
          .eq('org_id', orgId)
          .gte('occurred_at', rangeStartIso)
          .lt('occurred_at', rangeEndIso)
          .order('occurred_at', { ascending: true });

        if (filterProjectId !== 'all') q = q.eq('project_id', filterProjectId);

        const res = await q;

        if (res.error) throw res.error;
        const rows: TxRow[] = (res.data ?? []).map((r: any) => ({
          id: String(r.id),
          project_id: String(r.project_id ?? ''),
          type: String(r.type ?? ''),
          cost: Number(r.cost ?? 0) || 0,  
          category: String(r.category ?? ''),
          provider: String(r.provider ?? ''),
          occurred_at: String(r.occurred_at ?? ''),
        }));
        txRowsRef.current = rows;
        computeMetricsFromRows(rows, { start: rangeStartIso, end: rangeEndIso });
      } else {
        const raw = localStorage.getItem('transactions');
        const txs: any[] = raw ? JSON.parse(raw) : [];
        const rows: TxRow[] = txs.map((t) => ({
          id: String(t.id ?? `${t.type ?? ''}|${t.date ?? ''}|${t.cost ?? t.amount ?? 0}|${t.projectId ?? ''}|${t.description ?? ''}`),
          project_id: String(t.projectId ?? ''),
          type: String(t.type ?? ''),
          cost: Number(t.cost ?? t.amount ?? 0) || 0,
          category: String(t.category ?? ''),
          provider: String(t.provider ?? ''),
          occurred_at: String(t.date ?? ''),
        }));
        txRowsRef.current = rows;
        computeMetricsFromRows(rows, { start: rangeStartIso, end: rangeEndIso });
      }
    } catch (e: any) {
      console.error(e);
      setMetricsError(e?.message || 'Error cargando métricas');
      setMonthIncome(0);
      setMonthExpense(0);
      setLineData([]);
    }
  };

  useEffect(() => {
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCloud, orgId, filterProjectId, dateFrom, dateTo]);

  useEffect(() => {
    if (!useCloud || !orgId || !isSupabaseConfigured) return;

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`dashboard:${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `org_id=eq.${orgId}` },
        (payload) => {
          // Apply payload immediately for better UX, then reconcile via debounced reload.
          try {
            const eventType = String((payload as any)?.eventType || (payload as any)?.event || '').toUpperCase();

            if (eventType === 'DELETE') {
              const deletedId = (payload as any)?.old?.id;
              if (deletedId) {
                txRowsRef.current = txRowsRef.current.filter((r) => r.id !== String(deletedId));
                const range = txRangeRef.current ?? (() => {
                  const { startIso, endIso } = buildRange();
                  return { start: startIso, end: endIso };
                })();
                computeMetricsFromRows(txRowsRef.current, range);
              }
            } else {
              const row = (payload as any)?.new;
              const rowId = row?.id;
              if (rowId) {
                const nextRow: TxRow = {
                  id: String(rowId),
                  project_id: String(row?.project_id ?? ''),
                  type: String(row?.type ?? ''),
                  cost: Number(row?.cost ?? 0) || 0,
                  category: String(row?.category ?? ''),
                  provider: String(row?.provider ?? ''),
                  occurred_at: String(row?.occurred_at ?? ''),
                };

                const range = txRangeRef.current;
                const occurred = new Date(nextRow.occurred_at);
                const inRange =
                  range && !Number.isNaN(occurred.getTime())
                    ? occurred.getTime() >= new Date(range.start).getTime() && occurred.getTime() < new Date(range.end).getTime()
                    : true;

                const prev = txRowsRef.current;
                const idx = prev.findIndex((r) => r.id === nextRow.id);

                if (!inRange) {
                  txRowsRef.current = idx >= 0 ? prev.filter((r) => r.id !== nextRow.id) : prev;
                } else if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = nextRow;
                  next.sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
                  txRowsRef.current = next;
                } else {
                  const next = [...prev, nextRow];
                  next.sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
                  txRowsRef.current = next;
                }

                const metricRange = txRangeRef.current ?? (() => {
                  const { startIso, endIso } = buildRange();
                  return { start: startIso, end: endIso };
                })();
                computeMetricsFromRows(txRowsRef.current, metricRange);
              }
            }
          } catch (e) {
            console.error(e);
          }

          if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
          refreshTimer.current = window.setTimeout(() => {
            loadMetrics();
          }, 350);
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

  const net = monthIncome - monthExpense;
  const marginPct = monthIncome > 0 ? net / monthIncome : null;

  const handleExportPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const now = new Date();

    const title = 'M&S Construcción - Dashboard';
    doc.setFontSize(14);
    doc.text(title, 40, 40);
    doc.setFontSize(10);
    doc.text(`Generado: ${now.toLocaleString('es-GT')}`, 40, 58);
    doc.text(`Proyecto: ${filterProjectId === 'all' ? 'Todos' : (projects.find((p) => p.id === filterProjectId)?.name || filterProjectId)}`, 40, 72);
    doc.text(`Rango: ${dateFrom || '—'} a ${dateTo || '—'}`, 40, 86);

    const kpiRows = [
      ['Proyectos Activos', String(activeProjects)],
      ['Ingresos (Rango)', currency.format(monthIncome)],
      ['Gastos (Rango)', currency.format(monthExpense)],
      ['Utilidad Neta (Rango)', currency.format(net)],
      ['Margen (Rango)', marginPct === null ? '—' : `${Math.round(marginPct * 100)}%`],
    ];

    autoTable(doc, {
      startY: 105,
      head: [['KPI', 'Valor']],
      body: kpiRows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [10, 25, 47] },
    });

    const afterKpi = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 12 : 220;

    const lineRows = (lineData ?? []).map((r) => [r.name, String(r.ingresos), String(r.gastos)]);
    autoTable(doc, {
      startY: afterKpi,
      head: [['Mes', 'Ingresos', 'Gastos']],
      body: lineRows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [225, 173, 1] },
    });

    const afterLine = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 12 : afterKpi + 120;

    const topExpense = chartByCategoryExpense.map((r) => [r.name, currency.format(r.value)]);
    autoTable(doc, {
      startY: afterLine,
      head: [['Top Gastos por categoría', 'Total']],
      body: topExpense,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [220, 38, 38] },
    });

    doc.save(`dashboard_${dateFrom || 'inicio'}_${dateTo || 'fin'}.pdf`);
  };

  return (
    <div className="space-y-6">
      {/* Filters + Actions */}
      <div className="bg-white p-4 rounded-xl shadow">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="dash-project">Proyecto</label>
            <select
              id="dash-project"
              value={filterProjectId}
              onChange={(e) => setFilterProjectId(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
              title="Filtrar por proyecto"
            >
              <option value="all">Todos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="dash-from">Desde</label>
            <input
              id="dash-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
              title="Fecha inicio"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="dash-to">Hasta</label>
            <input
              id="dash-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg"
              title="Fecha fin"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => loadMetrics()}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 rounded-lg"
              title="Actualizar"
            >
              Actualizar
            </button>
            <button
              type="button"
              onClick={() => void onSyncNow?.()}
              className="flex-1 bg-navy-900 hover:bg-navy-800 text-white font-semibold py-2 rounded-lg"
              title="Sincronizar ahora"
              disabled={!useCloud || !orgId || !isSupabaseConfigured || !onSyncNow}
            >
              Sincronizar
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="flex-1 bg-mustard-500 hover:bg-mustard-600 text-black font-semibold py-2 rounded-lg"
              title="Exportar PDF"
            >
              Imprimir
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          Mostrando {filteredTxRows.length} movimientos en el rango seleccionado.
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-mustard-500">
           <h4 className="text-gray-500 text-sm">Proyectos Activos</h4>
           <p className="text-3xl font-bold text-navy-900">{activeProjects}</p>
        </div>
          <div className="bg-white p-6 rounded-xl shadow border-l-4 border-gray-400">
            <h4 className="text-gray-500 text-sm">Ingresos (Rango)</h4>
          <p className="text-3xl font-bold text-navy-900">{currency.format(monthIncome)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-red-500">
            <h4 className="text-gray-500 text-sm">Gastos (Rango)</h4>
          <p className="text-3xl font-bold text-navy-900">{currency.format(monthExpense)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-green-500">
           <h4 className="text-gray-500 text-sm">Utilidad Neta</h4>
          <p className={`text-3xl font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>{currency.format(net)}</p>
        </div>

          <div className="bg-white p-6 rounded-xl shadow border-l-4 border-gray-400">
            <h4 className="text-gray-500 text-sm">Margen (Rango)</h4>
          <p className="text-3xl font-bold text-navy-900">{marginPct === null ? '—' : `${Math.round(marginPct * 100)}%`}</p>
        </div>
      </div>

      {metricsError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
         {metricsError}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         <div className="bg-white p-6 rounded-xl shadow">
            <h3 className="font-bold text-gray-700 mb-4">Flujo de Caja (Mensual - Rango)</h3>
            <div className="h-64 min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={lineData}>  
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="ingresos" stroke="#0A192F" strokeWidth={2} />
                  <Line type="monotone" dataKey="gastos" stroke="#E1AD01" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
         </div>

         <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-bold text-gray-700 mb-4">Distribución por Tipología</h3>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
               <PieChart>  
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    fill="#0A192F"
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
         </div>
      </div>

      {/* Extra charts to reach executive view (data-driven) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-bold text-gray-700 mb-4">Gastos por Categoría (Top)</h3>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
               <BarChart data={chartByCategoryExpense}>  
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" hide={false} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#E1AD01" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-bold text-gray-700 mb-4">Ingresos por Categoría (Top)</h3>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
               <BarChart data={chartByCategoryIncome}>  
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#0A192F" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-bold text-gray-700 mb-4">Gastos por Proveedor (Top)</h3>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
               <BarChart data={chartByProviderExpense}>  
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#E1AD01" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-bold text-gray-700 mb-4">Saldo Acumulado (Rango)</h3>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
               <LineChart data={chartCumulative}>  
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="saldo" stroke="#0A192F" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-bold text-gray-700 mb-4">Ingresos vs Gastos por Proyecto (Top)</h3>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
               <BarChart data={chartByProject}>  
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="ingresos" stackId="a" fill="#0A192F" />
                <Bar dataKey="gastos" stackId="a" fill="#E1AD01" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-bold text-gray-700 mb-4">Utilidad Neta por Proyecto (Top)</h3>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
               <BarChart data={chartByProject}>  
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="neto" fill="#0A192F" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-bold text-gray-700 mb-4">Movimientos por Día</h3>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={chartDailyCount}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#0A192F" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow">
          <h3 className="font-bold text-gray-700 mb-4">Ingresos vs Gastos por Día</h3>
          <div className="h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={chartDailyFlow}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="ingresos" fill="#0A192F" />
                <Bar dataKey="gastos" fill="#E1AD01" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;