import React, { useEffect, useMemo, useState } from 'react';
import { Project, Employee } from '../types';
import { PAY_RATES } from '../constants';
import { UserPlus, MapPin, Copy, Send, FileText, Pencil, Save } from 'lucide-react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';

interface Props {
  projects: Project[];
  onListEmployees?: () => Promise<any[] | null>;
  onCreateEmployee?: (input: { name: string; dpi?: string; phone?: string; position: string; dailyRate: number; projectId?: string | null }) => Promise<any>;
  onListContracts?: () => Promise<any[] | null>;
  onUpsertContract?: (input: any) => Promise<any>;
  onListAttendance?: (workDate: string) => Promise<any[] | null>;
  onSetAttendanceToken?: (employeeId: string, token: string) => Promise<void>;
}

type PayRates = Record<string, number>;

type ContractSeed = {
  companyName: string;
  requestedAt: string;
  requestId: string;
  employeeId?: string;
  projectId?: string;
  employeeName: string;
  employeePhone?: string;
  role: string;
  dailyRate: number;
  projectName?: string;
};

type ContractResponse = ContractSeed & {
  dpi: string;
  phone: string;
  address: string;
  startDate: string;
  emergencyContact: string;
  accepted: boolean;
  responseAt: string;
};

type ContractRecord = {
  requestId: string;
  status: 'sent' | 'received';
  seed: ContractSeed;
  response?: ContractResponse;
};

const base64UrlEncode = (text: string) => {
  const b64 = btoa(unescape(encodeURIComponent(text)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlDecode = (b64url: string) => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const text = decodeURIComponent(escape(atob(padded)));
  return text;
};

const buildWhatsAppLink = (phoneRaw: string | null, text: string) => {
  const encoded = encodeURIComponent(text);
  const digits = (phoneRaw || '').replace(/\D/g, '');
  if (digits) return `https://wa.me/${digits}?text=${encoded}`;
  return `https://wa.me/?text=${encoded}`;
};

const toISODate = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const randomToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const safeNumber = (v: any, fallback = 0) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const RRHH: React.FC<Props> = ({ projects, onListEmployees, onCreateEmployee, onListContracts, onUpsertContract, onListAttendance, onSetAttendanceToken }) => {
  const [activeTab, setActiveTab] = useState<'CONTRATOS' | 'ASISTENCIA' | 'PLANILLA'>('CONTRATOS');
  
  const mockEmployees: Employee[] = useMemo(
    () => [
      { id: '1', name: 'Juan Pérez', dpi: '1234', position: 'Albañil', dailyRate: 175, status: 'active', phone: '55555555' },
      { id: '2', name: 'Carlos López', dpi: '5678', position: 'Peón', dailyRate: 100, status: 'active', phone: '44444444' }
    ],
    []
  );

  const STORAGE_EMPLOYEES = 'wm_employees_v1';
  const STORAGE_PAY_RATES = 'wm_pay_rates_v1';
  const STORAGE_EMPLOYEE_OVERRIDES = 'wm_employee_overrides_v1';
  const STORAGE_CONTRACTS = 'wm_contract_records_v1';

  const loadLocalEmployees = () => {
    try {
      const raw = localStorage.getItem(STORAGE_EMPLOYEES);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const mapped: Employee[] = parsed
        .filter((x: any) => x && typeof x.id === 'string')
        .map((x: any) => ({
          id: String(x.id),
          name: String(x.name || ''),
          dpi: String(x.dpi || ''),
          phone: String(x.phone || ''),
          position: (String(x.position || '') as any) || 'Peón',
          dailyRate: safeNumber(x.dailyRate, 0),
          status: (x.status as any) || 'active',
          projectId: x.projectId ? String(x.projectId) : undefined,
        }));
      return mapped;
    } catch {
      return null;
    }
  };

  const saveLocalEmployees = (list: Employee[]) => {
    try {
      localStorage.setItem(STORAGE_EMPLOYEES, JSON.stringify(list));
    } catch {
      // ignore
    }
  };

  const loadPayRates = (): PayRates => {
    try {
      const raw = localStorage.getItem(STORAGE_PAY_RATES);
      if (!raw) return { ...PAY_RATES } as any;
      const parsed = JSON.parse(raw) as Record<string, any>;
      const next: PayRates = {};
      Object.keys(PAY_RATES).forEach(k => {
        next[k] = safeNumber(parsed?.[k], (PAY_RATES as any)[k]);
      });
      return next;
    } catch {
      return { ...PAY_RATES } as any;
    }
  };

  const [payRates, setPayRates] = useState<PayRates>(loadPayRates);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PAY_RATES, JSON.stringify(payRates));
    } catch {
      // ignore
    }
  }, [payRates]);

  const loadOverrides = (): Record<string, number> => {
    try {
      const raw = localStorage.getItem(STORAGE_EMPLOYEE_OVERRIDES);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  };

  const [employeeRateOverrides, setEmployeeRateOverrides] = useState<Record<string, number>>(loadOverrides);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_EMPLOYEE_OVERRIDES, JSON.stringify(employeeRateOverrides));
    } catch {
      // ignore
    }
  }, [employeeRateOverrides]);

  const [employees, setEmployees] = useState<Employee[]>(() => loadLocalEmployees() ?? mockEmployees);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const [attendanceDate, setAttendanceDate] = useState<string>(() => toISODate(new Date()));
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  const refreshAttendance = async () => {
    if (!onListAttendance) {
      setAttendanceRows([]);
      return;
    }
    setLoadingAttendance(true);
    try {
      const rows = await onListAttendance(attendanceDate);
      setAttendanceRows(Array.isArray(rows) ? rows : []);
    } catch {
      setAttendanceRows([]);
    } finally {
      setLoadingAttendance(false);
    }
  };

  const [contractProjectId, setContractProjectId] = useState('');
  const [contractRole, setContractRole] = useState<string>('');
  const [contractName, setContractName] = useState('');
  const [contractDpi, setContractDpi] = useState('');
  const [contractPhone, setContractPhone] = useState('');
  const [contractDailyRate, setContractDailyRate] = useState<number>(0);

  useEffect(() => {
    if (!contractRole) {
      setContractDailyRate(0);
      return;
    }
    setContractDailyRate(safeNumber(payRates[contractRole], 0));
  }, [contractRole]);

  const [contractLink, setContractLink] = useState<string>('');
  const [contractSeedId, setContractSeedId] = useState<string>('');
  const [contractImportCode, setContractImportCode] = useState('');
  const [contracts, setContracts] = useState<ContractRecord[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CONTRACTS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as ContractRecord[];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CONTRACTS, JSON.stringify(contracts));
    } catch {
      // ignore
    }
  }, [contracts]);

  const refreshContracts = async () => {
    try {
      if (!onListContracts) return;
      const rows = await onListContracts();
      if (!rows || !Array.isArray(rows)) return;

      const mapped: ContractRecord[] = rows
        .filter((r: any) => r && (r.request_id || r.requestId))
        .map((r: any) => {
          const seed = (r.seed ?? {}) as ContractSeed;
          const response = (r.response ?? undefined) as ContractResponse | undefined;
          const requestId = String(r.request_id ?? r.requestId ?? seed.requestId);
          const status: 'sent' | 'received' = String(r.status ?? 'sent') === 'received' || response ? 'received' : 'sent';
          return { requestId, status, seed, response };
        });

      setContracts(prev => {
        const byId = new Map<string, ContractRecord>();
        prev.forEach((c) => byId.set(c.requestId, c));
        mapped.forEach((c) => {
          const existing = byId.get(c.requestId);
          if (!existing) {
            byId.set(c.requestId, c);
            return;
          }
          if (existing.status !== 'received' && c.status === 'received') {
            byId.set(c.requestId, c);
            return;
          }
          if (!existing.response && c.response) {
            byId.set(c.requestId, c);
            return;
          }
        });

        const next = Array.from(byId.values());
        next.sort((a, b) => {
          const ta = a.seed?.requestedAt ? Date.parse(a.seed.requestedAt) : 0;
          const tb = b.seed?.requestedAt ? Date.parse(b.seed.requestedAt) : 0;
          return tb - ta;
        });
        return next;
      });
    } catch {
      // ignore (localStorage fallback already exists)
    }
  };

  const refreshEmployees = async () => {
    setLoadingEmployees(true);
    try {
      if (onListEmployees) {
        const rows = await onListEmployees();
        if (rows && Array.isArray(rows)) {
          const mapped: Employee[] = rows.map((r: any) => ({
            id: String(r.id),
            name: String(r.name ?? ''),
            dpi: r.dpi ? String(r.dpi) : '',
            position: String(r.position ?? ''),
            dailyRate: safeNumber(r.daily_rate ?? r.dailyRate ?? 0, 0),
            status: (r.status as any) ?? 'active',
            phone: r.phone ? String(r.phone) : '',
            projectId: r.project_id ? String(r.project_id) : undefined,
          }));
          setEmployees(mapped.length > 0 ? mapped : []);
          return;
        }
      }

      const local = loadLocalEmployees();
      if (local) setEmployees(local);
    } catch {
      // Keep existing list if cloud fails
      const local = loadLocalEmployees();
      if (local) setEmployees(local);
    } finally {
      setLoadingEmployees(false);
    }
  };

  useEffect(() => {
    refreshEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onListEmployees]);

  useEffect(() => {
    refreshContracts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onListContracts]);

  useEffect(() => {
    if (activeTab !== 'ASISTENCIA') return;
    refreshAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, attendanceDate, onListAttendance]);

  const attendanceCenter = useMemo(() => {
    if (!attendanceRows || attendanceRows.length === 0) return null as [number, number] | null;
    const r = attendanceRows.find((x: any) => x && x.location_lat != null && x.location_lng != null);
    if (!r) return null;
    return [Number(r.location_lat), Number(r.location_lng)] as [number, number];
  }, [attendanceRows]);

  const handleGenerateWorkerLink = async (employeeId: string, phone: string | null) => {
    if (!onSetAttendanceToken) {
      alert('Supabase no configurado (no se puede generar link).');
      return;
    }
    const token = randomToken();
    try {
      await onSetAttendanceToken(employeeId, token);
    } catch (e: any) {
      alert(e?.message || 'No se pudo generar el token de asistencia');
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}#asistencia=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
    const go = confirm('Link generado (copiado si fue posible). ¿Enviar por WhatsApp al trabajador?');
    if (go) {
      const msg = [
        'M&S Construcción',
        'ASISTENCIA DIGITAL',
        '',
        'Abre este link para marcar tu entrada/salida con GPS:',
        url,
        '',
        'IMPORTANTE: Debes permitir ubicación (GPS).',
      ].join('\n');
      window.open(buildWhatsAppLink(phone, msg), '_blank', 'noopener,noreferrer');
    }
  };

  const employeesWithOverrides = useMemo(() => {
    return employees.map(e => {
      const override = employeeRateOverrides[e.id];
      if (override === undefined) return e;
      return { ...e, dailyRate: safeNumber(override, e.dailyRate) };
    });
  }, [employees, employeeRateOverrides]);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === contractProjectId) || null,
    [projects, contractProjectId]
  );

  const generateContractSeed = (opts?: { employeeId?: string | null; projectId?: string | null; employeePhone?: string | null }) => {
    const requestId = crypto.randomUUID();
    const seed: ContractSeed = {
      companyName: 'M&S Construcción',
      requestedAt: new Date().toISOString(),
      requestId,
      employeeId: opts?.employeeId ? String(opts.employeeId) : undefined,
      projectId: opts?.projectId ? String(opts.projectId) : undefined,
      employeeName: contractName.trim(),
      employeePhone: opts?.employeePhone ? String(opts.employeePhone) : undefined,
      role: contractRole,
      dailyRate: safeNumber(contractDailyRate, 0),
      projectName: selectedProject?.name,
    };
    return seed;
  };

  const buildContractIntakeUrl = (seed: ContractSeed) => {
    const payload = base64UrlEncode(JSON.stringify(seed));
    return `${window.location.origin}${window.location.pathname}#contract-intake=${payload}`;
  };

  const handleCopyContractLink = async () => {
    if (!contractLink) return;
    try {
      await navigator.clipboard.writeText(contractLink);
      alert('Link copiado.');
    } catch {
      alert('No se pudo copiar automáticamente. Copie manualmente el link.');
    }
  };

  const handleWhatsAppContractLink = () => {
    if (!contractLink) return;
    const msg = [
      'M&S Construcción',
      'CONTRATO DIGITAL',
      '',
      `Empleado: ${contractName.trim()}`,
      `Puesto: ${contractRole} (Q${formatRate(contractDailyRate)}/día)`,
      selectedProject?.name ? `Proyecto: ${selectedProject.name}` : null,
      '',
      'Por favor abrir el link y completar los datos:',
      contractLink,
      '',
      'Al finalizar, envíe el código de respuesta a RRHH.',
    ].filter(Boolean).join('\n');
    const link = buildWhatsAppLink(contractPhone || null, msg);
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  const formatRate = (n: number) => {
    const x = safeNumber(n, 0);
    return String(Math.round(x * 100) / 100);
  };

  const handleImportContract = async () => {
    const code = contractImportCode.trim();
    if (!code) return;
    try {
      const json = base64UrlDecode(code);
      const parsed = JSON.parse(json) as ContractResponse;
      if (!parsed?.requestId || !parsed?.employeeName) throw new Error('Formato inválido');

      const parsedProjectId = (parsed as any).projectId ? String((parsed as any).projectId) : undefined;
      const resolvedProjectId = parsedProjectId || selectedProject?.id;
      const projectForEmployee = resolvedProjectId;
      const resolvedProjectName = parsed.projectName || selectedProject?.name;

      const record: ContractRecord = {
        requestId: parsed.requestId,
        status: 'received',
        seed: {
          companyName: parsed.companyName,
          requestedAt: parsed.requestedAt,
          requestId: parsed.requestId,
          employeeId: (parsed as any).employeeId ? String((parsed as any).employeeId) : undefined,
          projectId: resolvedProjectId,
          employeeName: parsed.employeeName,
          employeePhone: (parsed as any).employeePhone ? String((parsed as any).employeePhone) : undefined,
          role: parsed.role,
          dailyRate: safeNumber(parsed.dailyRate, 0),
          projectName: resolvedProjectName,
        },
        response: parsed,
      };

      setContracts(prev => {
        const existingIndex = prev.findIndex(x => x.requestId === record.requestId);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = record;
          return next;
        }
        return [record, ...prev];
      });

      // Optionally create/update local employee record when Supabase isn't available
      const local = loadLocalEmployees() ?? [];
      const found = local.find(e => e.name.trim().toLowerCase() === parsed.employeeName.trim().toLowerCase() && (parsed.phone ? e.phone === parsed.phone : true));
      const dailyRate = safeNumber(parsed.dailyRate, 0);
      if (!found) {
        const created: Employee = {
          id: crypto.randomUUID(),
          name: parsed.employeeName,
          dpi: parsed.dpi || '',
          phone: parsed.phone || '',
          position: parsed.role as any,
          dailyRate,
          status: 'active',
          projectId: projectForEmployee || undefined,
        };
        const next = [created, ...local];
        saveLocalEmployees(next);
        setEmployees(next);
      } else {
        const next = local.map(e => (e.id === found.id ? ({ ...e, dpi: parsed.dpi || e.dpi, phone: parsed.phone || e.phone } as Employee) : e));
        saveLocalEmployees(next);
        setEmployees(next);
        setEmployeeRateOverrides(prev => ({ ...prev, [found.id]: dailyRate }));
      }

      try {
        if (onUpsertContract) {
          await onUpsertContract({
            requestId: record.requestId,
            status: 'received',
            seed: record.seed,
            response: parsed,
            employeeId: record.seed.employeeId ?? null,
            projectId: record.seed.projectId ?? null,
            requestedAt: record.seed.requestedAt,
            respondedAt: parsed.responseAt ?? null,
          });
          await refreshContracts();
        }
      } catch {
        // ignore cloud errors; local persistence already done
      }

      alert('Contrato importado.');
      setContractImportCode('');
    } catch (e: any) {
      alert(e?.message || 'No se pudo importar el contrato');
    }
  };

  const printContract = (c: ContractRecord) => {
    const seed = c.seed;
    const res = c.response;
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      alert('El navegador bloqueó la ventana de impresión.');
      return;
    }
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Contrato - ${seed.employeeName}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { font-size: 18px; margin: 0; }
            h2 { font-size: 14px; margin: 16px 0 6px; }
            .muted { color: #555; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            td, th { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
            .sig { margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
            .line { border-top: 1px solid #333; padding-top: 6px; }
          </style>
        </head>
        <body>
          <h1>${seed.companyName} - Contrato de Trabajo</h1>
          <div class="muted">Solicitud: ${new Date(seed.requestedAt).toLocaleString()} • ID: ${seed.requestId}</div>
          <h2>Datos</h2>
          <table>
            <tr><th>Empleado</th><td>${seed.employeeName}</td><th>Puesto</th><td>${seed.role}</td></tr>
            <tr><th>Proyecto</th><td colspan="3">${seed.projectName || '-'}</td></tr>
            <tr><th>Salario</th><td>Q${formatRate(seed.dailyRate)}/día</td><th>Inicio</th><td>${res?.startDate || '-'}</td></tr>
            <tr><th>DPI</th><td>${res?.dpi || '-'}</td><th>Teléfono</th><td>${res?.phone || '-'}</td></tr>
            <tr><th>Dirección</th><td colspan="3">${res?.address || '-'}</td></tr>
            <tr><th>Contacto emergencia</th><td colspan="3">${res?.emergencyContact || '-'}</td></tr>
          </table>
          <h2>Cláusulas (resumen)</h2>
          <div class="muted">Documento generado para impresión. Ajustar contenido legal según políticas de la empresa.</div>
          <ul>
            <li>Jornada y responsabilidades según puesto.</li>
            <li>Pago diario según tarifa indicada.</li>
            <li>Cumplimiento de normas de seguridad y reglamento interno.</li>
          </ul>
          <div class="sig">
            <div><div class="line">Firma Empleado</div></div>
            <div><div class="line">Firma Empresa</div></div>
          </div>
          <script>window.print();</script>
        </body>
      </html>
    `;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const handleSendContractLink = async () => {
    if (!contractName.trim()) {
      alert('Ingrese el nombre del empleado.');
      return;
    }
    if (!contractRole) {
      alert('Seleccione un puesto.');
      return;
    }

    const dailyRate = safeNumber(contractDailyRate || payRates[contractRole], 0);
    if (dailyRate <= 0) {
      alert('Ingrese un salario válido.');
      return;
    }

    let employeeId: string | null = null;

    try {
      if (onCreateEmployee) {
        const created = await onCreateEmployee({
          name: contractName.trim(),
          dpi: contractDpi.trim() || undefined,
          phone: contractPhone.trim() || undefined,
          position: contractRole,
          dailyRate,
          projectId: contractProjectId || null,
        });
        if (created?.id) {
          employeeId = String(created.id);
          await refreshEmployees();
        } else {
          // local fallback (when Supabase isn't configured / orgId missing)
          const local = loadLocalEmployees() ?? [];
          const next: Employee = {
            id: crypto.randomUUID(),
            name: contractName.trim(),
            dpi: contractDpi.trim() || '',
            phone: contractPhone.trim() || '',
            position: contractRole as any,
            dailyRate,
            status: 'active',
            projectId: contractProjectId || undefined,
          };
          employeeId = next.id;
          const nextList = [next, ...local];
          saveLocalEmployees(nextList);
          setEmployees(nextList);
        }
      } else {
        const local = loadLocalEmployees() ?? [];
        const next: Employee = {
          id: crypto.randomUUID(),
          name: contractName.trim(),
          dpi: contractDpi.trim() || '',
          phone: contractPhone.trim() || '',
          position: contractRole as any,
          dailyRate,
          status: 'active',
          projectId: contractProjectId || undefined,
        };
        employeeId = next.id;
        const nextList = [next, ...local];
        saveLocalEmployees(nextList);
        setEmployees(nextList);
      }
    } catch (e: any) {
      alert(e?.message || 'Error creando empleado');
      return;
    }

    const seed = generateContractSeed({
      employeeId,
      projectId: contractProjectId || null,
      employeePhone: contractPhone.trim() || null,
    });
    const intakeUrl = buildContractIntakeUrl(seed);
    setContractSeedId(seed.requestId);
    setContractLink(intakeUrl);
    setContracts(prev => [{ requestId: seed.requestId, status: 'sent', seed }, ...prev]);

    try {
      if (onUpsertContract) {
        await onUpsertContract({
          requestId: seed.requestId,
          status: 'sent',
          seed,
          response: null,
          employeeId: seed.employeeId ?? null,
          projectId: seed.projectId ?? null,
          requestedAt: seed.requestedAt,
          respondedAt: null,
        });
        await refreshContracts();
      }
    } catch {
      // ignore cloud errors; local persistence already done
    }

    const go = confirm('Empleado creado/registrado. ¿Abrir WhatsApp con el link de contrato?');
    if (go) handleWhatsAppContractLink();

    setContractName('');
    setContractDpi('');
    setContractPhone('');
    setContractRole('');
    setContractDailyRate(0);
  };

  const handleUpdateEmployeeRate = (employeeId: string, rate: number) => {
    const safe = safeNumber(rate, 0);
    setEmployeeRateOverrides(prev => ({ ...prev, [employeeId]: safe }));
  };

  return (
    <div className="space-y-6">
      <div className="flex space-x-2 border-b">
         <button onClick={() => setActiveTab('CONTRATOS')} className={`px-4 py-2 font-bold ${activeTab === 'CONTRATOS' ? 'border-b-2 border-mustard-500 text-navy-900' : 'text-gray-500'}`}>Contratación</button>
         <button onClick={() => setActiveTab('ASISTENCIA')} className={`px-4 py-2 font-bold ${activeTab === 'ASISTENCIA' ? 'border-b-2 border-mustard-500 text-navy-900' : 'text-gray-500'}`}>Asistencia (GPS)</button>
         <button onClick={() => setActiveTab('PLANILLA')} className={`px-4 py-2 font-bold ${activeTab === 'PLANILLA' ? 'border-b-2 border-mustard-500 text-navy-900' : 'text-gray-500'}`}>Planillas</button>
      </div>

      {activeTab === 'CONTRATOS' && (
        <div className="bg-white p-6 rounded-xl shadow-lg animate-fade-in">
           <h3 className="font-bold text-lg mb-4 flex items-center space-x-2">
             <UserPlus size={24} className="text-mustard-500" />
             <span>Generar Contrato Digital</span>
           </h3>

           <div className="mb-6 border rounded-lg p-4 bg-gray-50">
             <div className="flex items-center justify-between gap-2 mb-3">
               <div className="font-bold text-sm text-navy-900 flex items-center gap-2">
                 <Pencil size={16} className="text-mustard-500" />
                 Tarifas por puesto (Q/día)
               </div>
               <button
                 type="button"
                 className="text-xs px-3 py-1 rounded bg-white border hover:bg-gray-50"
                 onClick={() => setPayRates({ ...PAY_RATES } as any)}
                 title="Restaurar tarifas por defecto"
               >
                 Restaurar
               </button>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
               {Object.keys(PAY_RATES).map(role => (
                 <label key={role} className="text-xs text-gray-700 flex items-center justify-between gap-2 border bg-white rounded px-2 py-2">
                   <span className="font-semibold">{role}</span>
                   <input
                     type="number"
                     className="w-28 p-1 border rounded text-right"
                     value={safeNumber(payRates[role], (PAY_RATES as any)[role])}
                     onChange={e => setPayRates(prev => ({ ...prev, [role]: safeNumber(e.target.value, 0) }))}
                     min={0}
                       title={`Tarifa ${role} (Q/día)`}
                       aria-label={`Tarifa ${role} (Q/día)`}
                   />
                 </label>
               ))}
             </div>
             <div className="text-xs text-gray-500 mt-2">Se guardan en este navegador.</div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <select
               className="p-3 border rounded"
               aria-label="Seleccionar proyecto"
               title="Seleccionar proyecto"
               value={contractProjectId}
               onChange={(e) => setContractProjectId(e.target.value)}
             >
               <option>Seleccionar Proyecto...</option>
               {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
             </select>
             <select
               className="p-3 border rounded"
               aria-label="Seleccionar puesto"
               title="Seleccionar puesto"
               value={contractRole}
               onChange={(e) => setContractRole(e.target.value as any)}
             >
               <option>Seleccionar Puesto...</option>
               {Object.entries(payRates).map(([role, rate]) => (
                 <option key={role} value={role}>{role} - Q{formatRate(rate)}/día</option>
               ))}
             </select>
             <input
               placeholder="Nombre Completo"
               className="p-3 border rounded"
               value={contractName}
               onChange={(e) => setContractName(e.target.value)}
             />
             <input
               placeholder="DPI / CUI"
               className="p-3 border rounded"
               value={contractDpi}
               onChange={(e) => setContractDpi(e.target.value)}
             />
             <input
               placeholder="Teléfono"
               className="p-3 border rounded"
               value={contractPhone}
               onChange={(e) => setContractPhone(e.target.value)}
             />

             <div className="p-3 border rounded bg-gray-50 flex items-center justify-between gap-2">
               <div className="text-sm text-gray-600">Salario (Q/día)</div>
               <input
                 type="number"
                 className="w-32 p-2 border rounded text-right bg-white"
                 value={contractDailyRate}
                 onChange={e => setContractDailyRate(safeNumber(e.target.value, 0))}
                 min={0}
                 aria-label="Salario diario"
               />
             </div>

             <button
               onClick={handleSendContractLink}
               className="col-span-1 md:col-span-2 bg-navy-900 text-white py-3 rounded font-bold hover:bg-navy-800"
             >
               Enviar Link de Contrato (WhatsApp)
             </button>
           </div>

           {contractLink && (
             <div className="mt-4 border rounded-lg p-4 bg-blue-50 border-blue-200">
               <div className="font-bold text-blue-900 flex items-center gap-2"><FileText size={16} /> Link generado</div>
               <div className="text-xs text-blue-800 mt-1">ID: {contractSeedId}</div>
               <input
                 className="w-full p-2 border rounded mt-2 bg-white"
                 value={contractLink}
                 readOnly
                 title="Link de contrato"
                 aria-label="Link de contrato"
               />
               <div className="flex flex-col sm:flex-row gap-2 mt-2">
                 <button onClick={handleCopyContractLink} className="px-4 py-2 rounded bg-white border hover:bg-gray-50 flex items-center gap-2">
                   <Copy size={16} /> Copiar link
                 </button>
                 <button onClick={handleWhatsAppContractLink} className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 flex items-center gap-2">
                   <Send size={16} /> Abrir WhatsApp
                 </button>
               </div>
             </div>
           )}

           <div className="mt-6 border rounded-lg p-4 bg-gray-50">
             <div className="flex items-center justify-between gap-2 mb-2">
               <div>
                 <div className="font-bold text-sm text-navy-900 flex items-center gap-2"><Save size={16} className="text-mustard-500" /> Importar contrato recibido</div>
                 <div className="text-xs text-gray-500">Pegue aquí el código que envía el colaborador desde el link.</div>
               </div>
             </div>
             <textarea
               className="w-full p-2 border rounded text-xs font-mono bg-white"
               rows={4}
               value={contractImportCode}
               onChange={e => setContractImportCode(e.target.value)}
               placeholder="Pegue el código aquí…"
             />
             <button
               onClick={handleImportContract}
               className="mt-2 px-4 py-2 rounded bg-navy-900 text-white hover:bg-navy-800"
             >
               Importar
             </button>
           </div>

           <div className="mt-6">
             <h4 className="font-bold text-gray-700 mb-2">Contratos (enviados/recibidos)</h4>
             {contracts.length === 0 ? (
               <div className="text-sm text-gray-400 italic">Sin contratos aún.</div>
             ) : (
               <ul className="divide-y">
                 {contracts.slice(0, 10).map(c => (
                   <li key={c.requestId} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                     <div>
                       <div className="font-bold text-navy-900">{c.seed.employeeName} <span className="text-xs text-gray-500">({c.seed.role})</span></div>
                       <div className="text-xs text-gray-500">ID: {c.requestId} • {new Date(c.seed.requestedAt).toLocaleString()}</div>
                     </div>
                     <div className="flex gap-2">
                       <span className={`px-2 py-1 rounded-full text-xs font-bold ${c.status === 'received' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                         {c.status === 'received' ? 'RECIBIDO' : 'ENVIADO'}
                       </span>
                       <button
                         onClick={() => printContract(c)}
                         className="px-3 py-1 rounded bg-white border hover:bg-gray-50 text-xs"
                         title="Imprimir"
                       >
                         Imprimir
                       </button>
                     </div>
                   </li>
                 ))}
               </ul>
             )}
           </div>
           
           <div className="mt-8">
             <h4 className="font-bold text-gray-700 mb-2">Personal Activo</h4>
             {loadingEmployees && (
               <div className="text-sm text-gray-500 mb-2">Cargando personal...</div>
             )}
             <ul className="divide-y">
              {employeesWithOverrides.map(e => (
                 <li key={e.id} className="py-3 flex justify-between items-center">
                   <div>
                     <p className="font-bold text-navy-900">{e.name}</p>
                    <p className="text-xs text-gray-500">{e.position} • {e.phone} • Q{formatRate(e.dailyRate)}/día</p>
                   </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="w-24 p-1 border rounded text-right"
                      value={safeNumber(employeeRateOverrides[e.id] ?? e.dailyRate, e.dailyRate)}
                      onChange={ev => handleUpdateEmployeeRate(e.id, safeNumber(ev.target.value, 0))}
                      title="Salario diario"
                      aria-label={`Salario diario ${e.name}`}
                      min={0}
                    />
                    <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">ACTIVO</span>
                  </div>
                 </li>
               ))}
               {!loadingEmployees && employees.length === 0 && (
                 <li className="py-3 text-sm text-gray-400 italic">Sin personal registrado.</li>
               )}
             </ul>
           </div>
        </div>
      )}

      {activeTab === 'ASISTENCIA' && (
        <div className="bg-white p-6 rounded-xl shadow-lg animate-fade-in">
          <div className="flex justify-between items-center mb-6">
             <h3 className="font-bold text-lg">Control de Asistencia Biométrico/GPS</h3>
             <div className="flex items-center gap-2">
               <input
                 type="date"
                 className="p-2 border rounded text-sm"
                 value={attendanceDate}
                 onChange={(e) => setAttendanceDate(e.target.value)}
                 title="Fecha de asistencia"
                 aria-label="Fecha de asistencia"
               />
               <button
                 type="button"
                 className="bg-white border px-4 py-2 rounded font-bold hover:bg-gray-50 text-sm"
                 onClick={refreshAttendance}
                 title="Actualizar"
               >
                 Actualizar
               </button>
             </div>
          </div>

          {attendanceCenter ? (
            <div className="rounded overflow-hidden border mb-6">
              <MapContainer center={attendanceCenter} zoom={16} style={{ height: 320, width: '100%' }}>
                <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {attendanceRows
                  .filter((r: any) => r && r.location_lat != null && r.location_lng != null)
                  .map((r: any) => (
                    <Marker key={String(r.id)} position={[Number(r.location_lat), Number(r.location_lng)]}>
                      <Popup>
                        <div className="text-sm">
                          <div className="font-bold">{String(r.employee_name ?? '')}</div>
                          <div>{String(r.project_name ?? '—')}</div>
                          <div className="text-xs text-gray-600">
                            {r.check_in ? `Entrada: ${new Date(r.check_in).toLocaleTimeString()}` : ''}
                            {r.check_out ? ` • Salida: ${new Date(r.check_out).toLocaleTimeString()}` : ''}
                          </div>
                          <div className="text-xs text-gray-500">Precisión: {r.accuracy_m ? `${Math.round(Number(r.accuracy_m))} m` : 'N/A'}</div>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
              </MapContainer>
            </div>
          ) : (
            <div className="bg-gray-50 w-full rounded-lg flex items-center justify-center border border-dashed border-gray-300 mb-6 p-8">
              <p className="text-gray-500 font-medium flex flex-col items-center">
                <MapPin size={28} className="mb-2 text-red-500" />
                <span>Sin ubicaciones registradas para esta fecha.</span>
                <span className="text-xs">Genera el link al trabajador y marca asistencia.</span>
              </p>
            </div>
          )}

          <div className="mb-6">
            <div className="font-bold text-sm text-navy-900 mb-2">Links para App Trabajador</div>
            <div className="text-xs text-gray-600 mb-3">Genera un link único por trabajador para marcar asistencia con GPS. (Requiere Supabase + migración aplicada).</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {employeesWithOverrides.map((e) => (
                <div key={e.id} className="flex items-center justify-between p-3 bg-gray-50 rounded border">
                  <div>
                    <div className="font-bold text-sm">{e.name}</div>
                    <div className="text-xs text-gray-500">{e.position} • {e.phone || 'Sin teléfono'}</div>
                  </div>
                  <button
                    type="button"
                    className="text-sm px-3 py-2 rounded bg-white border hover:bg-gray-50"
                    onClick={() => handleGenerateWorkerLink(e.id, e.phone || null)}
                    title="Generar link de asistencia"
                  >
                    Generar link
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-bold text-sm text-navy-900">Asistencias del día</div>
            {loadingAttendance && <div className="text-sm text-gray-500">Cargando asistencias…</div>}
            {!loadingAttendance && attendanceRows.length === 0 && (
              <div className="text-sm text-gray-500">Sin registros para {attendanceDate}.</div>
            )}
            {attendanceRows.map((r: any) => (
              <div key={String(r.id)} className="flex items-center justify-between p-3 bg-gray-50 rounded border">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center font-bold text-white">
                    {String(r.employee_name ?? '?').charAt(0)}
                  </div>
                  <div>
                    <p className="font-bold">{String(r.employee_name ?? '')}</p>
                    <p className="text-xs text-gray-500">
                      Entrada: {r.check_in ? new Date(r.check_in).toLocaleTimeString() : '—'}
                      {r.check_out ? ` • Salida: ${new Date(r.check_out).toLocaleTimeString()}` : ''}
                      {r.accuracy_m ? ` • ±${Math.round(Number(r.accuracy_m))}m` : ''}
                    </p>
                    <p className="text-[11px] text-gray-500">{String(r.project_name ?? '')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="text-blue-600 hover:underline text-sm"
                  onClick={() => window.open(buildWhatsAppLink(r.employee_phone ? String(r.employee_phone) : null, 'Hola, tu asistencia fue registrada.'), '_blank', 'noopener,noreferrer')}
                  title="Enviar mensaje"
                >
                  Mensaje
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'PLANILLA' && (
        <div className="bg-white p-6 rounded-xl shadow-lg animate-fade-in">
          <h3 className="font-bold text-lg mb-4">Planilla Semanal Calculada</h3>
          <table className="w-full text-sm">
            <thead className="bg-navy-900 text-white">
              <tr>
                <th className="p-2 text-left">Empleado</th>
                <th className="p-2 text-center">Días</th>
                <th className="p-2 text-center">Extras</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {employeesWithOverrides.map(e => (
                <tr key={e.id} className="border-b">
                  <td className="p-3">{e.name} <br/><span className="text-xs text-gray-500">{e.position}</span></td>
                  <td className="p-3 text-center">6</td>
                  <td className="p-3 text-center">0</td>
                  <td className="p-3 text-right font-bold">Q{(e.dailyRate * 6).toFixed(2)}</td>
                  <td className="p-3 text-center"><span className="text-yellow-600 font-bold">Pendiente</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 text-right">
             <button className="bg-mustard-500 text-black px-6 py-2 rounded font-bold shadow-md hover:bg-mustard-600">
               Imprimir y Pagar
             </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RRHH;