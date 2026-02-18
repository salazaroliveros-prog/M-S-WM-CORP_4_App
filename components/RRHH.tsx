import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Project, Employee } from '../types';
import { PAY_RATES } from '../constants';
import { UserPlus, MapPin, Copy, Send, FileText, Pencil, Save } from 'lucide-react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getSupabaseClient } from '../lib/supabaseClient';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

interface Props {
  projects: Project[];
  syncVersion?: number;
  isAdmin?: boolean;
  onListEmployees?: () => Promise<any[] | null>;
  onCreateEmployee?: (input: { name: string; dpi?: string; phone?: string; position: string; dailyRate: number; projectId?: string | null }) => Promise<any>;
  onListContracts?: () => Promise<any[] | null>;
  onUpsertContract?: (input: any) => Promise<any>;
  onListAttendance?: (workDate: string) => Promise<any[] | null>;
  onSetAttendanceToken?: (employeeId: string, token: string) => Promise<void>;
  onLoadPayRates?: () => Promise<Record<string, number> | null>;
  onSavePayRates?: (payRates: Record<string, number>) => Promise<void>;
  onLoadEmployeeRateOverrides?: () => Promise<Record<string, number> | null>;
  onUpsertEmployeeRateOverride?: (employeeId: string, dailyRate: number) => Promise<void>;
  onDeleteEmployeeRateOverride?: (employeeId: string) => Promise<void>;
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

const isLikelyUuid = (s: string) => {
  const v = String(s || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
};

const requireNonEmptyTrim = (v: any, label: string) => {
  const s = String(v ?? '').trim();
  if (!s) throw new Error(`${label} requerido.`);
  return s;
};

const isLikelyIsoDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());

const normalizeCompareText = (s: any) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

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

const RRHH: React.FC<Props> = ({
  projects,
  syncVersion,
  isAdmin,
  onListEmployees,
  onCreateEmployee,
  onListContracts,
  onUpsertContract,
  onListAttendance,
  onSetAttendanceToken,
  onLoadPayRates,
  onSavePayRates,
  onLoadEmployeeRateOverrides,
  onUpsertEmployeeRateOverride,
  onDeleteEmployeeRateOverride,
}) => {
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
    if (!onLoadPayRates) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await onLoadPayRates();
        if (cancelled) return;
        if (remote && typeof remote === 'object') {
          setPayRates((prev) => ({ ...prev, ...remote }));
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onLoadPayRates, syncVersion]);

  useEffect(() => {
    if (!onLoadEmployeeRateOverrides) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await onLoadEmployeeRateOverrides();
        if (cancelled) return;
        if (remote && typeof remote === 'object') {
          setEmployeeRateOverrides(remote);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onLoadEmployeeRateOverrides, syncVersion]);

  useEffect(() => {
    if (!onSavePayRates) return;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          await onSavePayRates(payRates);
        } catch {
          // ignore
        }
      })();
    }, 700);
    return () => window.clearTimeout(t);
  }, [payRates, onSavePayRates]);

  useEffect(() => {
    if (!onUpsertEmployeeRateOverride && !onDeleteEmployeeRateOverride) return;
    const snapshot = { ...employeeRateOverrides };
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const entries = Object.entries(snapshot);
          for (const [employeeId, rate] of entries) {
            const safe = safeNumber(rate, 0);
            if (safe <= 0) {
              if (onDeleteEmployeeRateOverride) await onDeleteEmployeeRateOverride(employeeId);
            } else {
              if (onUpsertEmployeeRateOverride) await onUpsertEmployeeRateOverride(employeeId, safe);
            }
          }
        } catch {
          // ignore
        }
      })();
    }, 700);
    return () => window.clearTimeout(t);
  }, [employeeRateOverrides, onUpsertEmployeeRateOverride, onDeleteEmployeeRateOverride]);
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

  const [payrollStart, setPayrollStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return toISODate(d);
  });
  const [payrollEnd, setPayrollEnd] = useState<string>(() => toISODate(new Date()));
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [payrollComputed, setPayrollComputed] = useState<Record<string, { daysWorked: number }>>({});

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

  const refreshContracts = useCallback(async () => {
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
  }, [onListContracts]);

  useEffect(() => {
    if (activeTab !== 'CONTRATOS') return;
    // Auto-refresh so RRHH sees applicant submissions without reloading.
    const id = window.setInterval(() => {
      refreshContracts();
    }, 5000);
    return () => window.clearInterval(id);
  }, [activeTab, refreshContracts]);

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
            position: String(r.position ?? '') as Employee['position'],
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
  }, [onListEmployees, syncVersion]);

  useEffect(() => {
    refreshContracts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onListContracts, syncVersion]);

  useEffect(() => {
    if (activeTab !== 'ASISTENCIA') return;
    refreshAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, attendanceDate, onListAttendance, syncVersion]);

  const attendanceCenter = useMemo(() => {
    if (!attendanceRows || attendanceRows.length === 0) return null as [number, number] | null;
    const r = attendanceRows.find((x: any) => {
      if (!x) return false;
      const lat = Number(x.location_lat);
      const lng = Number(x.location_lng);
      return Number.isFinite(lat) && Number.isFinite(lng);
    });
    if (!r) return null;
    const lat = Number(r.location_lat);
    const lng = Number(r.location_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng] as [number, number];
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
        'IMPORTANTE:',
        '- Debes permitir ubicación (GPS).',
        '- Si te aparece opción de instalar, selecciona “Agregar a la pantalla de inicio”.',
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
      'Al finalizar, envía el CÓDIGO DE RESPUESTA a RRHH.',
      'Nota: el código contiene datos personales; no lo compartas con terceros.',
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
      const requestId = requireNonEmptyTrim(parsed?.requestId, 'requestId');
      if (!isLikelyUuid(requestId)) throw new Error('requestId inválido. Solicita un nuevo link a RRHH.');
      const employeeName = requireNonEmptyTrim(parsed?.employeeName, 'Nombre del empleado');
      const role = requireNonEmptyTrim(parsed?.role, 'Puesto');
      if (!parsed?.accepted) throw new Error('El colaborador no aceptó la confirmación.');
      requireNonEmptyTrim(parsed?.dpi, 'DPI / CUI');
      requireNonEmptyTrim(parsed?.phone, 'Teléfono');
      const startDate = requireNonEmptyTrim(parsed?.startDate, 'Fecha de inicio');
      if (!isLikelyIsoDateOnly(startDate)) throw new Error('Fecha de inicio inválida.');

      const existing = contracts.find((c) => c.requestId === requestId) || null;
      if (existing?.seed) {
        if (normalizeCompareText(existing.seed.employeeName) !== normalizeCompareText(employeeName)) {
          throw new Error('El código no coincide con el empleado del link generado (requestId existente).');
        }
        if (normalizeCompareText(existing.seed.role) !== normalizeCompareText(role)) {
          throw new Error('El código no coincide con el puesto del link generado (requestId existente).');
        }
      }

      const parsedProjectId = (parsed as any).projectId ? String((parsed as any).projectId) : undefined;
      const resolvedProjectId = parsedProjectId || selectedProject?.id;
      const projectForEmployee = resolvedProjectId;
      const resolvedProjectName = parsed.projectName || selectedProject?.name;

      const seedSource = existing?.seed;

      const record: ContractRecord = {
        requestId,
        status: 'received',
        seed: {
          companyName: seedSource?.companyName ?? parsed.companyName,
          requestedAt: seedSource?.requestedAt ?? parsed.requestedAt,
          requestId,
          employeeId: seedSource?.employeeId ?? ((parsed as any).employeeId ? String((parsed as any).employeeId) : undefined),
          projectId: seedSource?.projectId ?? resolvedProjectId,
          employeeName: seedSource?.employeeName ?? employeeName,
          employeePhone: seedSource?.employeePhone ?? ((parsed as any).employeePhone ? String((parsed as any).employeePhone) : undefined),
          role: seedSource?.role ?? role,
          dailyRate: safeNumber(seedSource?.dailyRate ?? parsed.dailyRate, 0),
          projectName: seedSource?.projectName ?? resolvedProjectName,
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

  const downloadContractPdf = (c: ContractRecord) => {
    if (!c.response) {
      alert('Este contrato aún no tiene respuesta del colaborador.');
      return;
    }

    const seed = c.seed;
    const res = c.response;
    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    let y = 44;

    const title = `${seed.companyName || 'Empresa'}\nCONTRATO INDIVIDUAL DE TRABAJO (PLANTILLA)`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(title, margin, y);
    y += 44;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Solicitud: ${new Date(seed.requestedAt).toLocaleString()}   •   ID: ${seed.requestId}`, margin, y);
    y += 18;
    doc.text(`Generado: ${new Date().toLocaleString()} (RRHH)`, margin, y);
    y += 18;

    autoTable(doc as any, {
      startY: y,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
      head: [['Campo', 'Valor']],
      body: [
        ['Empleado', seed.employeeName],
        ['DPI / CUI', res.dpi || '—'],
        ['Teléfono', res.phone || '—'],
        ['Dirección', res.address || '—'],
        ['Puesto', seed.role],
        ['Proyecto / Obra', seed.projectName || '—'],
        ['Fecha de inicio', res.startDate || '—'],
        ['Salario', `Q${formatRate(seed.dailyRate)}/día`],
        ['Contacto emergencia', res.emergencyContact || '—'],
      ],
      margin: { left: margin, right: margin },
    });

    y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 18 : y + 18;

    const addSection = (heading: string, content: string) => {
      const maxWidth = pageWidth - margin * 2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(heading, margin, y);
      y += 14;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(content, maxWidth);
      doc.text(lines, margin, y);
      y += lines.length * 12 + 10;
    };

    addSection(
      '1) Objeto',
      'El colaborador se obliga a prestar sus servicios personales bajo dirección de la empresa en el puesto indicado, en el proyecto/obra señalado, cumpliendo normas de seguridad, calidad y reglamento interno.'
    );
    addSection(
      '2) Jornada y lugar de trabajo',
      'La jornada se regirá por la planificación de obra y podrá variar según necesidades operativas. El lugar de trabajo será el proyecto/obra asignado o donde la empresa indique para fines de la ejecución del trabajo.'
    );
    addSection(
      '3) Remuneración',
      `La empresa pagará al colaborador una remuneración de Q${formatRate(seed.dailyRate)}/día laborado. La forma de pago será según planilla (semanal o quincenal) y controles internos de asistencia.`
    );
    addSection(
      '4) Control de asistencia y evidencia',
      'El colaborador acepta el registro de asistencia mediante GPS y evidencia biométrica/código conforme al sistema implementado. Dichos registros podrán usarse para control de planilla y auditoría.'
    );
    addSection(
      '5) Terminación',
      'Este documento es una plantilla operativa. Debe ser revisado y ajustado por la empresa conforme a normativa laboral aplicable y políticas internas.'
    );

    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('Firmas', margin, y);
    y += 22;
    doc.setFont('helvetica', 'normal');
    doc.text('______________________________', margin, y);
    doc.text('______________________________', pageWidth / 2 + 10, y);
    y += 14;
    doc.text('Colaborador', margin, y);
    doc.text('Empresa', pageWidth / 2 + 10, y);

    const safeName = String(seed.employeeName || 'Contrato')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9\-_.\s]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    doc.save(`Contrato-${safeName || 'Empleado'}-${seed.requestId}.pdf`);
  };

  const downloadPayrollPdf = () => {
    const startLabel = payrollStart || '';
    const endLabel = payrollEnd || '';

    const projectNameById = new Map<string, string>();
    projects.forEach((p) => {
      if (p?.id) projectNameById.set(String(p.id), String(p.name ?? ''));
    });

    const rows = employeesWithOverrides.map((e) => {
      const daysWorked = payrollComputed[e.id]?.daysWorked ?? 6;
      const dailyRate = safeNumber(employeeRateOverrides[e.id] ?? e.dailyRate, e.dailyRate);
      const total = dailyRate * daysWorked;
      const projectName = e.projectId ? (projectNameById.get(String(e.projectId)) ?? '') : '';
      return {
        employee: e.name,
        position: String(e.position ?? ''),
        projectName,
        daysWorked,
        dailyRate,
        total,
      };
    });

    const grandTotal = rows.reduce((sum, r) => sum + safeNumber(r.total, 0), 0);

    const doc = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    let y = 44;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('M&S Construcción', margin, y);
    y += 18;
    doc.setFontSize(12);
    doc.text('PLANILLA SEMANAL (CONTROL INTERNO)', margin, y);
    y += 18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Periodo: ${startLabel || '—'} a ${endLabel || '—'}`, margin, y);
    y += 14;
    doc.text(`Generado: ${new Date().toLocaleString()}`, margin, y);
    y += 14;

    autoTable(doc as any, {
      startY: y + 6,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
      head: [['Empleado', 'Puesto', 'Proyecto/Obra', 'Días', 'Salario Día (Q)', 'Total (Q)', 'Observaciones']],
      body: rows.map((r) => [
        r.employee,
        r.position,
        r.projectName || '—',
        String(r.daysWorked),
        (Math.round(r.dailyRate * 100) / 100).toFixed(2),
        (Math.round(r.total * 100) / 100).toFixed(2),
        '',
      ]),
      columnStyles: {
        3: { halign: 'center' },
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
      margin: { left: margin, right: margin },
    });

    const tableEndY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY : y + 120;
    y = tableEndY + 18;

    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL GENERAL: Q${(Math.round(grandTotal * 100) / 100).toFixed(2)}`, margin, y);
    y += 26;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('______________________________', margin, y);
    doc.text('______________________________', pageWidth / 2 + 10, y);
    y += 14;
    doc.text('Recibí (Empleado / Representante)', margin, y);
    doc.text('Entrega (Empresa)', pageWidth / 2 + 10, y);

    doc.save(`Planilla-Semanal-${startLabel || 'inicio'}-a-${endLabel || 'fin'}.pdf`);
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
            .box { border: 1px solid #ddd; padding: 10px; margin-top: 10px; }
          </style>
        </head>
        <body>
          <h1>${seed.companyName} - Contrato Individual de Trabajo (Plantilla)</h1>
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
          <h2>Cláusulas (resumen operativo)</h2>
          <div class="box">
            <div class="muted">Este documento es una plantilla profesional para control interno (RRHH/obra). Ajustar y validar contenido legal según normativa aplicable.</div>
            <ol>
              <li><b>Objeto:</b> prestación de servicios en el puesto indicado bajo dirección de la empresa.</li>
              <li><b>Jornada:</b> según planificación de obra y necesidades operativas.</li>
              <li><b>Remuneración:</b> Q${formatRate(seed.dailyRate)}/día laborado, según planilla y controles internos.</li>
              <li><b>Seguridad:</b> cumplimiento de normas de SST y reglamento interno.</li>
              <li><b>Asistencia:</b> registro con GPS y evidencia biométrica/código para control de planilla.</li>
            </ol>
          </div>
          <div class="muted" style="margin-top:10px">Sugerencia: en el diálogo de impresión seleccione “Guardar como PDF”.</div>
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

  // TODO: Replace this with the actual logic to get the current user's employee ID
  const myEmployeeId = ''; // Set this to the correct employee ID

  const [status, setStatus] = useState<{ message: string; success: boolean } | string | null>(null);

  const handleMarkMyAttendance = async () => {
    if (!myEmployeeId) {
      setStatus({ message: 'No se encontró el ID del empleado actual.', success: false });
      return;
    }
    const { error } = await getSupabaseClient()
      .from('attendance')
      .insert([{ employee_id: myEmployeeId, work_date: new Date().toISOString().slice(0, 10), type: 'propio' }]);
    if (error) {
      setStatus({ message: 'Error al registrar asistencia', success: false });
    } else {
      setStatus({ message: '¡Asistencia registrada!', success: true });
    }
  };

  const handleMarkOtherAttendance = () => {
    alert('Funcionalidad para marcar asistencia de otro no implementada.');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <h1 className="text-2xl font-bold mb-6">Asistencia M&S</h1>
      <button className="btn-primary mb-4" onClick={handleMarkMyAttendance}>
        Marcar mi asistencia
      </button>
      <button className="btn-secondary mb-4" onClick={handleMarkOtherAttendance}>
        Marcar asistencia de otro
      </button>
      {status && (
        <div className="mt-4 text-red-600">
          {typeof status === 'string'
            ? status
            : (status && typeof status === 'object' && 'message' in status)
              ? (status as any).message
              : ''}
        </div>
      )}
      <ToastContainer aria-label="Notificaciones" />
    </div>
  );
};

export default RRHH;

export function useRealtimeAttendance(onNewAttendance) {
  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('attendance-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, payload => {
        onNewAttendance(payload.new);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onNewAttendance]);
}