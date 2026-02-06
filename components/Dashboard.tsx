import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Project } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { isSupabaseConfigured, getSupabaseClient } from '../lib/supabaseClient';

interface Props {
  projects: Project[];
  useCloud?: boolean;
  orgId?: string | null;
}

const Dashboard: React.FC<Props> = ({ projects, useCloud = false, orgId = null }) => {
  const activeProjects = projects.filter(p => p.status === 'active').length;

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#7C3AED'];

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

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthsBack = 5;
    const rangeStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);

    const monthKeys: { key: string; label: string }[] = [];
    for (let i = monthsBack; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('es', { month: 'short' }).replace('.', '');
      monthKeys.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1) });
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

    try {
      if (useCloud && orgId && isSupabaseConfigured) {
        const supabase = getSupabaseClient();
        const res = await supabase
          .from('transactions')
          .select('type, cost, occurred_at')
          .eq('org_id', orgId)
          .gte('occurred_at', rangeStart.toISOString())
          .lt('occurred_at', new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString())
          .order('occurred_at', { ascending: true });

        if (res.error) throw res.error;
        for (const r of res.data ?? []) {
          accumulate(r.type, Number(r.cost ?? 0), String(r.occurred_at));
        }
      } else {
        const raw = localStorage.getItem('transactions');
        const txs: any[] = raw ? JSON.parse(raw) : [];
        for (const t of txs) {
          accumulate(t.type, Number(t.cost ?? t.amount ?? 0), String(t.date));
        }
      }

      const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
      const monthBucket = buckets.get(monthKey) ?? { ingresos: 0, gastos: 0 };
      setMonthIncome(monthBucket.ingresos);
      setMonthExpense(monthBucket.gastos);

      const nextLine: LinePoint[] = monthKeys.map((m) => {
        const b = buckets.get(m.key) ?? { ingresos: 0, gastos: 0 };
        return { name: m.label, ingresos: Math.round(b.ingresos), gastos: Math.round(b.gastos) };
      });
      setLineData(nextLine);
    } catch (e: any) {
      console.error(e);
      setMetricsError(e?.message || 'Error cargando métricas');
      setMonthIncome(0);
      setMonthExpense(0);
      setLineData(monthKeys.map((m) => ({ name: m.label, ingresos: 0, gastos: 0 })));
    }
  };

  useEffect(() => {
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useCloud, orgId]);

  useEffect(() => {
    if (!useCloud || !orgId || !isSupabaseConfigured) return;

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`dashboard:${orgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `org_id=eq.${orgId}` },
        () => {
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

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-mustard-500">
           <h4 className="text-gray-500 text-sm">Proyectos Activos</h4>
           <p className="text-3xl font-bold text-navy-900">{activeProjects}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-blue-500">
           <h4 className="text-gray-500 text-sm">Ingresos (Mes)</h4>
          <p className="text-3xl font-bold text-navy-900">{currency.format(monthIncome)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-red-500">
           <h4 className="text-gray-500 text-sm">Gastos (Mes)</h4>
          <p className="text-3xl font-bold text-navy-900">{currency.format(monthExpense)}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-green-500">
           <h4 className="text-gray-500 text-sm">Utilidad Neta</h4>
          <p className={`text-3xl font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>{currency.format(net)}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow border-l-4 border-gray-400">
           <h4 className="text-gray-500 text-sm">Margen (Mes)</h4>
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
            <h3 className="font-bold text-gray-700 mb-4">Flujo de Caja (6 meses)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
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
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    fill="#8884d8"
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
    </div>
  );
};

export default Dashboard;