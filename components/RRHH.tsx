import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  orgId?: string | null;
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
  signatureUrl?: string; // firma digital (dataURL)
  selfieUrl?: string;    // selfie (dataURL)
  experienceYears?: number; // años de experiencia
  references?: { company: string; type: string }[]; // referencias laborales
};

// Requisitos mínimos por puesto
const minExperienceByRole: Record<string, number> = {
    Supervisor: 4,
    Encargado: 4,
    'Maestro de obras': 4,
    Albañil: 4,
    Ayudante: 0,
    Peón: 0,
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

// Cálculo de pago semanal por minutos/horas trabajadas
function calcularPagoPorHoras(asis: any[], dailyRate: number): { dias: number; minutos: number; pago: number } {
  let totalMin = 0;
  let dias = 0;
  asis.forEach((a) => {
    if (a?.check_in && a?.check_out) {
      const inTime = new Date(`${a.work_date || a.date}T${a.check_in}`);
      const outTime = new Date(`${a.work_date || a.date}T${a.check_out}`);
      const min = (outTime.getTime() - inTime.getTime()) / 60000;
      if (min > 0) {
        totalMin += min;
        dias += 1;
      }
    }
  });
  const pago = (totalMin / (8 * 60)) * dailyRate; // 8h jornada
  return { dias, minutos: Math.round(totalMin), pago: Math.round(pago * 100) / 100 };
}

// Función para calcular minutos fuera de obra (penalizable)
function calcularMinutosFuera(asis: any[]): number {
  let total = 0;
  asis.forEach((a) => {
    if (!a?.check_in || !a?.check_out) return;

    const workDate = String(a.work_date || a.date || '').slice(0, 10);
    const toDateTime = (t: any) => {
      const raw = String(t ?? '').trim();
      if (!raw) return null;
      if (raw.includes('T')) return new Date(raw);
      if (/^\d{2}:\d{2}/.test(raw) && workDate) return new Date(`${workDate}T${raw}`);
      return new Date(raw);
    };

    const checkIn = toDateTime(a.check_in || a.checkIn);
    const checkOut = toDateTime(a.check_out || a.checkOut);
    if (!checkIn || !checkOut) return;
    if (!Number.isFinite(checkIn.getTime()) || !Number.isFinite(checkOut.getTime())) return;

    if (a.outside_allowed_radius) {
      const diff = (checkOut.getTime() - checkIn.getTime()) / 60000;
      if (diff > 0) total += diff;
    }
  });
  return Math.round(total);
}

const RRHH: React.FC<Props> = ({
  projects,
  syncVersion,
  isAdmin,
  orgId,
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

  const STORAGE_EMPLOYEES = 'wm_employees_v1';
  const STORAGE_PAY_RATES = 'wm_pay_rates_v1';
  const STORAGE_EMPLOYEE_OVERRIDES = 'wm_employee_overrides_v1';
  const STORAGE_CONTRACTS = 'wm_contract_records_v1';

  const STORAGE_ATTENDANCE_MANUAL = 'wm_offline_attendance_manual_v1';
  const STORAGE_PENDING_ATTENDANCE_MANUAL = 'wm_pending_attendance_manual_v1';

  const readJson = <T,>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  const writeJson = (key: string, value: any) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  };

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

  const [employees, setEmployees] = useState<Employee[]>(() => loadLocalEmployees() ?? []);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const [attendanceDate, setAttendanceDate] = useState<string>(() => toISODate(new Date()));
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const attendanceRefreshTimerRef = useRef<number | null>(null);

  const [payrollAttendanceRows, setPayrollAttendanceRows] = useState<any[]>([]);
  const [loadingPayrollAttendance, setLoadingPayrollAttendance] = useState(false);

  const [alerts, setAlerts] = useState<string[]>([]);
  const [editingAttendance, setEditingAttendance] = useState<any | null>(null);
  const [newAttendance, setNewAttendance] = useState<any>({ employee_id: '', work_date: '', check_in: '', check_out: '', location_lat: '', location_lng: '' });

  const [payrollStart, setPayrollStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return toISODate(d);
  });
  const [payrollEnd, setPayrollEnd] = useState<string>(() => toISODate(new Date()));
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [payrollComputed, setPayrollComputed] = useState<Record<string, { daysWorked: number }>>({});

  const refreshAttendance = useCallback(async () => {
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
  }, [attendanceDate, onListAttendance]);

  const scheduleRefreshAttendance = useCallback(() => {
    // Avoid hammering network when multiple realtime events arrive.
    if (attendanceRefreshTimerRef.current) window.clearTimeout(attendanceRefreshTimerRef.current);
    attendanceRefreshTimerRef.current = window.setTimeout(() => {
      void refreshAttendance();
    }, 250);
  }, [refreshAttendance]);

  useEffect(() => {
    return () => {
      if (attendanceRefreshTimerRef.current) {
        window.clearTimeout(attendanceRefreshTimerRef.current);
        attendanceRefreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    if (!orgId) return;
    if (activeTab !== 'ASISTENCIA') return;
    if (!attendanceDate || !isLikelyIsoDateOnly(attendanceDate)) return;

    const supabase = getSupabaseClient();
    const filter = `org_id=eq.${orgId},work_date=eq.${attendanceDate}`;
    const channel = supabase
      .channel(`attendance-realtime-admin:${orgId}:${attendanceDate}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance', filter },
        (payload) => {
          const row = (payload as any)?.new;
          if (!row) return;
          setAttendanceRows((prev) => {
            const id = String(row?.id || '');
            if (!id) return [row, ...prev];
            const next = Array.isArray(prev) ? [...prev] : [];
            const idx = next.findIndex((r) => String((r as any)?.id || '') === id);
            if (idx >= 0) next[idx] = { ...(next[idx] as any), ...(row as any) };
            else next.unshift(row);
            return next;
          });
          scheduleRefreshAttendance();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'attendance', filter },
        (payload) => {
          const row = (payload as any)?.new;
          if (!row) return;
          setAttendanceRows((prev) => {
            const id = String(row?.id || '');
            if (!id) return [row, ...prev];
            const next = Array.isArray(prev) ? [...prev] : [];
            const idx = next.findIndex((r) => String((r as any)?.id || '') === id);
            if (idx >= 0) next[idx] = { ...(next[idx] as any), ...(row as any) };
            else next.unshift(row);
            return next;
          });
          scheduleRefreshAttendance();
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'attendance', filter },
        (payload) => {
          const row = (payload as any)?.old;
          const id = String(row?.id || '');
          if (!id) return;
          setAttendanceRows((prev) => (Array.isArray(prev) ? prev.filter((r) => String((r as any)?.id || '') !== id) : []));
          scheduleRefreshAttendance();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab, attendanceDate, isAdmin, orgId, scheduleRefreshAttendance]);

  const refreshPayrollAttendance = useCallback(async () => {
    if (!isAdmin) {
      setPayrollAttendanceRows([]);
      return;
    }
    if (!payrollStart || !payrollEnd) {
      setPayrollAttendanceRows([]);
      return;
    }

    setLoadingPayrollAttendance(true);
    try {
      const localAll = readJson<any[]>(STORAGE_ATTENDANCE_MANUAL, []);
      const local = Array.isArray(localAll)
        ? localAll.filter((r) => {
            const d = String(r?.work_date || r?.date || '').slice(0, 10);
            if (!d) return false;
            return String(d) >= String(payrollStart) && String(d) <= String(payrollEnd);
          })
        : [];

      // Try cloud; if it fails (offline), keep local rows.
      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from('attendance')
          .select('*')
          .gte('work_date', payrollStart)
          .lte('work_date', payrollEnd);

        if (error) throw error;
        const remote = Array.isArray(data) ? data : [];
        const byId = new Map<string, any>();
        remote.forEach((r: any) => {
          if (r?.id) byId.set(String(r.id), r);
        });
        local.forEach((r: any) => {
          if (r?.id) byId.set(String(r.id), r);
        });
        setPayrollAttendanceRows(Array.from(byId.values()));
      } catch {
        setPayrollAttendanceRows(local);
      }
    } finally {
      setLoadingPayrollAttendance(false);
    }
  }, [isAdmin, payrollStart, payrollEnd]);

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

  // Experiencia y referencias para validación por puesto
  const [experienceYears, setExperienceYears] = useState<number>(0);
  const [references, setReferences] = useState<{ company: string; type: string }[]>([]);
  const [referenceCompany, setReferenceCompany] = useState('');
  const [referenceType, setReferenceType] = useState('');

  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
    // Funciones para firma digital
    const clearSignature = () => {
      const canvas = signatureCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        setSignatureUrl(null);
      }
    };
    const saveSignature = () => {
      const canvas = signatureCanvasRef.current;
      if (canvas) {
        setSignatureUrl(canvas.toDataURL('image/png'));
      }
    };
    // Función para selfie
    const handleSelfieChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => setSelfieUrl(ev.target?.result as string);
      reader.readAsDataURL(file);
    };
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
          const seed = { ...(r.seed ?? {}) } as ContractSeed;
          // Hydrate seed with authoritative columns (older rows may not embed these in seed)
          if (!seed.employeeId && r.employee_id) seed.employeeId = String(r.employee_id);
          if (!seed.projectId && r.project_id) seed.projectId = String(r.project_id);
          if (!seed.employeePhone && r.employee_phone) seed.employeePhone = String(r.employee_phone);
          if (!seed.employeeName && r.employee_name) seed.employeeName = String(r.employee_name);
          if (!seed.role && r.role) seed.role = String(r.role);
          if ((seed.dailyRate == null || Number.isNaN(Number(seed.dailyRate))) && r.daily_rate != null) {
            (seed as any).dailyRate = safeNumber(r.daily_rate, 0);
          }
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

  useEffect(() => {
    if (activeTab !== 'PLANILLA') return;
    refreshPayrollAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, payrollStart, payrollEnd, syncVersion]);

  // Inactivación y reactivación automática de empleados
  useEffect(() => {
    setEmployees(prev => prev.map(e => {
      const att = attendanceRows.filter(a => a.employee_id === e.id);
      if (!att.length) return { ...e, status: 'inactive' };
      const last = att.reduce((max, a) => {
        const d = new Date(a.work_date || a.date);
        return d > max ? d : max;
      }, new Date(0));
      const diff = (new Date().getTime() - last.getTime()) / (1000 * 60 * 60 * 24);
      if (diff >= 3) return { ...e, status: 'inactive' };
      if (e.status === 'inactive' && diff < 3) return { ...e, status: 'active' };
      return e;
    }));
  }, [attendanceRows]);

  // Alertas automáticas por asistencia (ausencias, fuera de radio, etc)
  useEffect(() => {
    if (!isAdmin) return;
    const newAlerts: string[] = [];
    const now = new Date();
    employees.forEach(e => {
      const att = attendanceRows.filter(a => a.employee_id === e.id);
      if (att.length === 0) {
        newAlerts.push(`Empleado ${e.name} nunca ha registrado asistencia.`);
        return;
      }
      const last = att.reduce((max, a) => {
        const d = new Date(a.work_date || a.date);
        return d > max ? d : max;
      }, new Date(0));
      const diff = (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24);
      if (diff >= 3) newAlerts.push(`Empleado ${e.name} inactivo (ausente ${Math.floor(diff)} días)`);
    });
    attendanceRows.forEach(a => {
      if (a.outside_allowed_radius) {
        const emp = employees.find(e => e.id === a.employee_id);
        if (emp) newAlerts.push(`Asistencia fuera de radio: ${emp.name} (${a.work_date || a.date})`);
      }
    });
    setAlerts(newAlerts);
  }, [isAdmin, employees, attendanceRows]);

  const handleSaveAttendance = async () => {
    if (!newAttendance.employee_id || !newAttendance.work_date) return;

    const row = { ...newAttendance, id: crypto.randomUUID() };
    const existing = readJson<any[]>(STORAGE_ATTENDANCE_MANUAL, []);
    writeJson(STORAGE_ATTENDANCE_MANUAL, [row, ...(Array.isArray(existing) ? existing : [])]);

    const pending = readJson<any[]>(STORAGE_PENDING_ATTENDANCE_MANUAL, []);
    writeJson(STORAGE_PENDING_ATTENDANCE_MANUAL, [...(Array.isArray(pending) ? pending : []), { type: 'upsert', row }]);

    try {
      await getSupabaseClient().from('attendance').upsert([{ ...row }]);
    } catch {
      // offline or RLS; queued for later
    }

    setNewAttendance({ employee_id: '', work_date: '', check_in: '', check_out: '', location_lat: '', location_lng: '' });
    refreshAttendance();
  };

  const handleUpdateAttendance = async () => {
    if (!editingAttendance || !editingAttendance.id) return;

    const existing = readJson<any[]>(STORAGE_ATTENDANCE_MANUAL, []);
    const next = Array.isArray(existing)
      ? existing.map((r) => (String(r?.id) === String(editingAttendance.id) ? { ...r, ...editingAttendance } : r))
      : [editingAttendance];
    writeJson(STORAGE_ATTENDANCE_MANUAL, next);

    const pending = readJson<any[]>(STORAGE_PENDING_ATTENDANCE_MANUAL, []);
    writeJson(STORAGE_PENDING_ATTENDANCE_MANUAL, [...(Array.isArray(pending) ? pending : []), { type: 'upsert', row: editingAttendance }]);

    try {
      await getSupabaseClient().from('attendance').update(editingAttendance).eq('id', editingAttendance.id);
    } catch {
      // offline; queued for later
    }

    setEditingAttendance(null);
    refreshAttendance();
  };

  const handleDeleteAttendance = async (id: string) => {
    const existing = readJson<any[]>(STORAGE_ATTENDANCE_MANUAL, []);
    writeJson(
      STORAGE_ATTENDANCE_MANUAL,
      Array.isArray(existing) ? existing.filter((r) => String(r?.id) !== String(id)) : []
    );

    const pending = readJson<any[]>(STORAGE_PENDING_ATTENDANCE_MANUAL, []);
    writeJson(STORAGE_PENDING_ATTENDANCE_MANUAL, [...(Array.isArray(pending) ? pending : []), { type: 'delete', id }]);

    try {
      await getSupabaseClient().from('attendance').delete().eq('id', id);
    } catch {
      // offline; queued for later
    }
    refreshAttendance();
  };

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

  const acceptedEmployeeIds = useMemo(() => {
    const set = new Set<string>();
    contracts.forEach((c) => {
      if (c?.status !== 'received') return;
      if (c?.response?.accepted !== true) return;
      const id = c?.seed?.employeeId ? String(c.seed.employeeId) : '';
      if (id) set.add(id);
    });
    return set;
  }, [contracts]);

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
      'Al finalizar, si tienes internet se enviará automáticamente a RRHH.',
      'Si no se envía automáticamente, envía el CÓDIGO DE RESPUESTA a RRHH.',
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
      requireNonEmptyTrim(parsed?.phone, 'Teléfono');
      const accepted = Boolean(parsed?.accepted);

      if (accepted) {
        requireNonEmptyTrim(parsed?.dpi, 'DPI / CUI');
        const startDate = requireNonEmptyTrim(parsed?.startDate, 'Fecha de inicio');
        if (!isLikelyIsoDateOnly(startDate)) throw new Error('Fecha de inicio inválida.');
        // Validar firma y selfie
        if (!signatureUrl) throw new Error('Debe capturar la firma digital del colaborador.');
        if (!selfieUrl) throw new Error('Debe capturar la selfie del colaborador.');
        // Validar experiencia y referencias
        const minExp = minExperienceByRole[role] ?? 0;
        if (experienceYears < minExp) throw new Error(`El puesto requiere al menos ${minExp} años de experiencia.`);
        if (['Supervisor','Encargado','Maestro de obras','Albañil'].includes(role) && references.length < 2) throw new Error('Debe ingresar al menos 2 referencias laborales para este puesto.');
      }

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
        response: { ...parsed, signatureUrl, selfieUrl, experienceYears, references },
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
      if (accepted) {
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

      alert(accepted ? 'Contrato importado.' : 'Rechazo importado.');
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
      const dailyRate = safeNumber(employeeRateOverrides[e.id] ?? e.dailyRate, e.dailyRate);
      const asis = payrollAttendanceRows.filter(a => a.employee_id === e.id);
      const { dias, minutos, pago } = calcularPagoPorHoras(asis, dailyRate);
      const minutosFuera = calcularMinutosFuera(asis);
      const descuento = (minutosFuera / (8 * 60)) * dailyRate * dias;
      const total = pago - descuento;
      const projectName = e.projectId ? (projectNameById.get(String(e.projectId)) ?? '') : '';
      return {
        employee: e.name,
        position: String(e.position ?? ''),
        projectName,
        daysWorked: dias,
        dailyRate,
        total,
        descuento: Math.round(descuento * 100) / 100,
        minutosFuera,
        minutosTrabajados: minutos,
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
      head: [['Empleado', 'Puesto', 'Proyecto/Obra', 'Días', 'Min. trabajados', 'Salario Día (Q)', 'Total (Q)', 'Descuento (Q)', 'Min. fuera', 'Observaciones']],
      body: rows.map((r) => [
        r.employee,
        r.position,
        r.projectName || '—',
        String(r.daysWorked),
        r.minutosTrabajados || 0,
        (Math.round(r.dailyRate * 100) / 100).toFixed(2),
        (Math.round(r.total * 100) / 100).toFixed(2),
        (Math.round((r.descuento || 0) * 100) / 100).toFixed(2),
        r.minutosFuera || 0,
        '',
      ]),
      columnStyles: {
        3: { halign: 'center' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
        8: { halign: 'right' },
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
    // Buscar proyecto asignado al empleado
    const empleado = employees.find(e => e.id === myEmployeeId);
    const proyecto = empleado && empleado.projectId ? projects.find(p => p.id === empleado.projectId) : null;
    let projectCoords: [number, number] | null = null;
    if (proyecto && proyecto.coordinates) {
      const match = proyecto.coordinates.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
      if (match) projectCoords = [parseFloat(match[1]), parseFloat(match[2])];
    }
    // Obtener ubicación actual
    if (!navigator.geolocation) {
      setStatus({ message: 'El dispositivo no soporta geolocalización.', success: false });
      return;
    }
    setStatus('Obteniendo ubicación...');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      let fueraRadio = false;
      let distancia = 0;
      if (projectCoords) {
        // Calcular distancia Haversine
        const toRad = (v: number) => (v * Math.PI) / 180;
        const R = 6371000; // metros
        const dLat = toRad(lat - projectCoords[0]);
        const dLng = toRad(lng - projectCoords[1]);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(projectCoords[0])) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distancia = R * c;
        fueraRadio = distancia > 100;
      }
      if (fueraRadio) {
        setStatus({ message: `Fuera del radio permitido (${Math.round(distancia)}m del proyecto).`, success: false });
        return;
      }
      // Registrar asistencia con ubicación
      const { error } = await getSupabaseClient()
        .from('attendance')
        .insert([{ employee_id: myEmployeeId, work_date: new Date().toISOString().slice(0, 10), type: 'propio', location_lat: lat, location_lng: lng, outside_allowed_radius: fueraRadio }]);
      if (error) {
        setStatus({ message: 'Error al registrar asistencia', success: false });
      } else {
        setStatus({ message: '¡Asistencia registrada!', success: true });
      }
    }, (err) => {
      setStatus({ message: 'No se pudo obtener la ubicación.', success: false });
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  const handleMarkOtherAttendance = () => {
    if (!isAdmin) {
      alert('Solo admin puede marcar asistencia de otros.');
      return;
    }
    if (!employees || employees.length === 0) {
      alert('No hay empleados registrados.');
      return;
    }

    const maxList = 30;
    const list = employees
      .slice(0, maxList)
      .map((e, idx) => `${idx + 1}) ${e.name}`)
      .join('\n');
    const suffix = employees.length > maxList ? `\n... y ${employees.length - maxList} más` : '';
    const pick = prompt(`Seleccione empleado (número):\n${list}${suffix}`);
    if (!pick) return;
    const n = Number(pick);
    if (!Number.isFinite(n) || n < 1 || n > Math.min(maxList, employees.length)) {
      alert('Selección inválida.');
      return;
    }
    const emp = employees[n - 1];
    if (!emp) return;

    const workDate = attendanceDate || new Date().toISOString().slice(0, 10);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const checkIn = `${hh}:${mm}`;

    const saveRow = async (coords?: { lat: number; lng: number }) => {
      const row = {
        id: crypto.randomUUID(),
        employee_id: emp.id,
        work_date: workDate,
        check_in: checkIn,
        check_out: '',
        location_lat: coords ? String(coords.lat) : '',
        location_lng: coords ? String(coords.lng) : '',
      };

      const existing = readJson<any[]>(STORAGE_ATTENDANCE_MANUAL, []);
      writeJson(STORAGE_ATTENDANCE_MANUAL, [row, ...(Array.isArray(existing) ? existing : [])]);

      const pending = readJson<any[]>(STORAGE_PENDING_ATTENDANCE_MANUAL, []);
      writeJson(STORAGE_PENDING_ATTENDANCE_MANUAL, [...(Array.isArray(pending) ? pending : []), { type: 'upsert', row }]);

      try {
        await getSupabaseClient().from('attendance').upsert([{ ...row }]);
      } catch {
        // offline or RLS; queued for later
      }

      refreshAttendance();
    };

    if (!navigator.geolocation) {
      void saveRow();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void saveRow({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        void saveRow();
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // ...existing code...
  // Al renderizar el selector de puesto, deshabilitar si no hay vacante
  // Ejemplo de uso en el selector:
  // <select ...>
  //   {Object.keys(VACANTES_POR_PUESTO).map(puesto => (
  //     <option key={puesto} value={puesto} disabled={!hayVacante(puesto)}>
  //       {puesto} {!hayVacante(puesto) ? '(Sin vacante)' : ''}
  //     </option>
  //   ))}
  // </select>
  // UI para importar contrato con firma y selfie
  const renderSignatureAndSelfie = () => (
    <div className="my-4">
      <label className="block font-bold mb-1" htmlFor="signature-canvas">Firma digital del colaborador:</label>
      <canvas
        id="signature-canvas"
        ref={signatureCanvasRef}
        width={320}
        height={100}
        className="border border-gray-400 bg-white signature-canvas touch-none rounded"
        onPointerDown={e => {
          const canvas = signatureCanvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.beginPath();
          ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
          const move = (ev: PointerEvent) => {
            ctx.lineTo(ev.offsetX, ev.offsetY);
            ctx.stroke();
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            saveSignature();
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
      <div className="flex gap-2 mt-1">
        <button type="button" className="btn-secondary" onClick={clearSignature}>Limpiar</button>
      </div>
      <label className="block font-bold mt-4 mb-1" htmlFor="selfie-input">Selfie del colaborador:</label>
      <input id="selfie-input" type="file" accept="image/*" onChange={handleSelfieChange} title="Subir selfie" />
      {selfieUrl && <img src={selfieUrl} alt="Selfie" className="mt-2 rounded shadow w-32 h-32 object-cover" />}
      <div className="mt-4">
        <label className="block font-bold mb-1" htmlFor="experience-years">Años de experiencia en el puesto:</label>
        <input id="experience-years" type="number" min="0" value={experienceYears} onChange={e => setExperienceYears(Number(e.target.value))} className="input input-bordered w-24" title="Años de experiencia" />
      </div>
      <div className="mt-4">
        <label className="block font-bold mb-1">Referencias laborales (mínimo 2 para puestos técnicos):</label>
        <div className="flex gap-2 mb-2">
          <input type="text" placeholder="Empresa" value={referenceCompany} onChange={e => setReferenceCompany(e.target.value)} className="input input-bordered w-40" />
          <input type="text" placeholder="Tipo obra (residencial, comercial, etc)" value={referenceType} onChange={e => setReferenceType(e.target.value)} className="input input-bordered w-40" />
          <button type="button" className="btn-primary" onClick={() => {
            if (referenceCompany && referenceType) {
              setReferences([...references, { company: referenceCompany, type: referenceType }]);
              setReferenceCompany('');
              setReferenceType('');
            }
          }}>Agregar</button>
        </div>
        <ul className="list-disc ml-6">
          {references.map((r, i) => (
            <li key={i}>{r.company} ({r.type}) <button type="button" className="text-red-600 ml-2" onClick={() => setReferences(references.filter((_, idx) => idx !== i))}>Quitar</button></li>
          ))}
        </ul>
      </div>
    </div>
  );

  const payrollPreviewRows = useMemo(() => {
    const projectNameById = new Map<string, string>();
    projects.forEach((p) => {
      if (p?.id) projectNameById.set(String(p.id), String(p.name ?? ''));
    });

    return employeesWithOverrides.map((e) => {
      const dailyRate = safeNumber(employeeRateOverrides[e.id] ?? e.dailyRate, e.dailyRate);
      const asis = payrollAttendanceRows.filter((a) => a.employee_id === e.id);
      const { dias, minutos, pago } = calcularPagoPorHoras(asis, dailyRate);
      const minutosFuera = calcularMinutosFuera(asis);
      const descuento = (minutosFuera / (8 * 60)) * dailyRate * dias;
      const total = pago - descuento;
      const projectName = e.projectId ? (projectNameById.get(String(e.projectId)) ?? '') : '';
      return {
        employeeId: e.id,
        employee: e.name,
        position: String(e.position ?? ''),
        projectName,
        daysWorked: dias,
        minutesWorked: minutos,
        minutesOutside: minutosFuera,
        dailyRate,
        total: Math.round(total * 100) / 100,
        discount: Math.round(descuento * 100) / 100,
      };
    });
  }, [employeesWithOverrides, employeeRateOverrides, payrollAttendanceRows, projects]);

  const payrollGrandTotal = useMemo(() => {
    return payrollPreviewRows.reduce((sum, r) => sum + safeNumber(r.total, 0), 0);
  }, [payrollPreviewRows]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <h1 className="text-2xl font-bold mb-4">RRHH M&S</h1>

      <div className="w-full max-w-4xl flex gap-2 mb-6">
        <button
          type="button"
          className={activeTab === 'CONTRATOS' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('CONTRATOS')}
        >
          Contratos
        </button>
        <button
          type="button"
          className={activeTab === 'ASISTENCIA' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('ASISTENCIA')}
        >
          Asistencia
        </button>
        <button
          type="button"
          className={activeTab === 'PLANILLA' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setActiveTab('PLANILLA')}
        >
          Planilla
        </button>
      </div>

      {activeTab === 'CONTRATOS' && (
        <div className="w-full max-w-4xl space-y-6">
          <div className="bg-white rounded shadow p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><FileText size={18} /> Generar contrato</h2>
            <div className="flex flex-wrap gap-2">
              <input value={contractName} onChange={(e) => setContractName(e.target.value)} className="input input-bordered" placeholder="Nombre" />
              <input value={contractDpi} onChange={(e) => setContractDpi(e.target.value)} className="input input-bordered" placeholder="DPI" />
              <input value={contractPhone} onChange={(e) => setContractPhone(e.target.value)} className="input input-bordered" placeholder="Teléfono" />
              <select value={contractRole} onChange={(e) => setContractRole(e.target.value)} className="input input-bordered" aria-label="Puesto" title="Puesto">
                <option value="">Puesto</option>
                {Object.keys(PAY_RATES).map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <select value={contractProjectId} onChange={(e) => setContractProjectId(e.target.value)} className="input input-bordered" aria-label="Proyecto" title="Proyecto">
                <option value="">Proyecto</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="number"
                value={contractDailyRate}
                onChange={(e) => setContractDailyRate(Number(e.target.value))}
                className="input input-bordered w-32"
                placeholder="Q/día"
                title="Salario diario"
              />
              <button type="button" className="btn-primary" onClick={handleSendContractLink}>Enviar link</button>
            </div>

            {contractLink && (
              <div className="mt-3">
                <div className="text-sm mb-2 break-all">{contractLink}</div>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" onClick={handleCopyContractLink}><Copy size={16} /> Copiar</button>
                  <button type="button" className="btn-primary" onClick={handleWhatsAppContractLink}><Send size={16} /> WhatsApp</button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded shadow p-4">
            <h2 className="font-bold mb-3">Importar respuesta de contrato (código)</h2>
            {renderSignatureAndSelfie()}
            <div className="flex flex-wrap gap-2 items-center">
              <input
                value={contractImportCode}
                onChange={(e) => setContractImportCode(e.target.value)}
                className="input input-bordered flex-1"
                placeholder="Pega el CÓDIGO DE RESPUESTA"
              />
              <button type="button" className="btn-primary" onClick={handleImportContract}>Importar</button>
            </div>
          </div>

          <div className="bg-white rounded shadow p-4">
            <h2 className="font-bold mb-3">Contratos</h2>
            <table className="table-auto w-full text-xs">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Puesto</th>
                  <th>Proyecto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr
                    key={c.requestId}
                    className={
                      c.status !== 'received'
                        ? ''
                        : c.response?.accepted === true
                          ? 'bg-green-50'
                          : c.response?.accepted === false
                            ? 'bg-red-50'
                            : 'bg-green-50'
                    }
                  >
                    <td>{c.seed.employeeName}</td>
                    <td>{c.seed.role}</td>
                    <td>{c.seed.projectName || '—'}</td>
                    <td>
                      {c.status === 'received'
                        ? (c.response?.accepted === true ? 'Aceptado' : c.response?.accepted === false ? 'Rechazado' : 'Recibido')
                        : 'Enviado'}
                    </td>
                    <td className="whitespace-nowrap">
                      <button type="button" className="btn-secondary btn-xs mr-1" onClick={() => printContract(c)}>Imprimir</button>
                      <button type="button" className="btn-secondary btn-xs" onClick={() => downloadContractPdf(c)}>PDF</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded shadow p-4">
            <h2 className="font-bold mb-3">Empleados (links de asistencia)</h2>
            <table className="table-auto w-full text-xs">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Puesto</th>
                  <th>Teléfono</th>
                  <th>Q/día</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {employeesWithOverrides.map((e) => {
                  const canSendLink = Boolean(onSetAttendanceToken) && acceptedEmployeeIds.has(e.id);
                  return (
                    <tr key={e.id}>
                      <td>{e.name}</td>
                      <td>{String(e.position ?? '')}</td>
                      <td>{e.phone || '—'}</td>
                      <td>
                        <input
                          type="number"
                          className="input input-bordered w-28"
                          value={employeeRateOverrides[e.id] ?? ''}
                          placeholder={String(e.dailyRate ?? '')}
                          onChange={(ev) => handleUpdateEmployeeRate(e.id, Number(ev.target.value))}
                          title="Override salario diario"
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        <button
                          type="button"
                          className={canSendLink ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'}
                          disabled={!canSendLink}
                          title={!onSetAttendanceToken ? 'Supabase no configurado' : (!acceptedEmployeeIds.has(e.id) ? 'Requiere contrato aceptado (recibido)' : '')}
                          onClick={() => handleGenerateWorkerLink(e.id, e.phone || null)}
                        >
                          Enviar link
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!onSetAttendanceToken && (
              <div className="text-xs text-gray-500 mt-2">Nota: para generar links, configure Supabase (RPC set_employee_attendance_token).</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'ASISTENCIA' && (
        <div className="w-full max-w-4xl space-y-6">
          {isAdmin && alerts.length > 0 && (
            <div className="w-full">
              {alerts.map((a, i) => (
                <div key={i} className="bg-red-100 border border-red-300 text-red-700 rounded p-2 mb-2 text-sm font-semibold">
                  {a}
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded shadow p-4">
            <h2 className="font-bold mb-3 flex items-center gap-2"><MapPin size={18} /> Asistencia por día</h2>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="date"
                value={attendanceDate}
                onChange={(e) => setAttendanceDate(e.target.value)}
                className="input input-bordered"
                aria-label="Fecha"
                title="Fecha"
              />
              <button type="button" className="btn-secondary" onClick={refreshAttendance} disabled={loadingAttendance}>
                {loadingAttendance ? 'Cargando...' : 'Refrescar'}
              </button>
              <button type="button" className="btn-primary" onClick={handleMarkMyAttendance}>Marcar mi asistencia</button>
              <button type="button" className="btn-secondary" onClick={handleMarkOtherAttendance}>Marcar asistencia de otro</button>
            </div>

            {isAdmin && attendanceCenter && (
              <div className="my-4 w-full h-96 rounded-xl overflow-hidden shadow">
                <MapContainer key={attendanceDate} center={attendanceCenter} zoom={16} style={{ width: '100%', height: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {attendanceRows
                    .filter((x) => Number.isFinite(Number(x?.location_lat)) && Number.isFinite(Number(x?.location_lng)))
                    .map((row, idx) => (
                      <Marker key={String(row?.id ?? `${row?.employee_id ?? 'emp'}_${row?.work_date ?? attendanceDate}_${idx}`)} position={[Number(row.location_lat), Number(row.location_lng)]}>
                        <Popup>
                          <div>
                            <b>{employees.find((e) => e.id === row.employee_id)?.name || row.employee_id || 'Empleado'}</b>
                            <br />
                            {row.check_in ? `Entrada: ${row.check_in}` : ''}
                            <br />
                            {row.check_out ? `Salida: ${row.check_out}` : ''}
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                </MapContainer>
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="bg-white rounded shadow p-4">
              <h2 className="font-bold mb-2">Asistencias manuales</h2>
              <div className="flex gap-2 mb-2 flex-wrap">
                <select value={newAttendance.employee_id} onChange={e => setNewAttendance(a => ({ ...a, employee_id: e.target.value }))} className="input input-bordered" aria-label="Empleado" title="Empleado">
                  <option value="">Empleado</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <input type="date" value={newAttendance.work_date} onChange={e => setNewAttendance(a => ({ ...a, work_date: e.target.value }))} className="input input-bordered" title="Fecha" aria-label="Fecha" />
                <input type="time" value={newAttendance.check_in} onChange={e => setNewAttendance(a => ({ ...a, check_in: e.target.value }))} className="input input-bordered" placeholder="Check-in" />
                <input type="time" value={newAttendance.check_out} onChange={e => setNewAttendance(a => ({ ...a, check_out: e.target.value }))} className="input input-bordered" placeholder="Check-out" />
                <input type="number" step="any" value={newAttendance.location_lat} onChange={e => setNewAttendance(a => ({ ...a, location_lat: e.target.value }))} className="input input-bordered w-24" placeholder="Lat" />
                <input type="number" step="any" value={newAttendance.location_lng} onChange={e => setNewAttendance(a => ({ ...a, location_lng: e.target.value }))} className="input input-bordered w-24" placeholder="Lng" />
                <button type="button" className="btn-primary" onClick={handleSaveAttendance}>Agregar</button>
              </div>
              <table className="table-auto w-full text-xs">
                <thead><tr><th>Empleado</th><th>Fecha</th><th>Check-in</th><th>Check-out</th><th>Lat</th><th>Lng</th><th></th></tr></thead>
                <tbody>
                  {attendanceRows.map(a => (
                    <tr key={a.id} className={editingAttendance && editingAttendance.id === a.id ? 'bg-yellow-100' : ''}>
                      <td>{employees.find(e => e.id === a.employee_id)?.name || a.employee_id}</td>
                      <td>{a.work_date || a.date}</td>
                      <td>{a.check_in || a.checkIn || ''}</td>
                      <td>{a.check_out || a.checkOut || ''}</td>
                      <td>{a.location_lat || ''}</td>
                      <td>{a.location_lng || ''}</td>
                      <td>
                        <button type="button" className="btn-secondary btn-xs mr-1" onClick={() => setEditingAttendance({ ...a })}>Editar</button>
                        <button type="button" className="btn-error btn-xs" onClick={() => handleDeleteAttendance(a.id)}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editingAttendance && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  <input type="time" value={editingAttendance.check_in || ''} onChange={e => setEditingAttendance(a => ({ ...a, check_in: e.target.value }))} className="input input-bordered" placeholder="Check-in" />
                  <input type="time" value={editingAttendance.check_out || ''} onChange={e => setEditingAttendance(a => ({ ...a, check_out: e.target.value }))} className="input input-bordered" placeholder="Check-out" />
                  <input type="number" step="any" value={editingAttendance.location_lat || ''} onChange={e => setEditingAttendance(a => ({ ...a, location_lat: e.target.value }))} className="input input-bordered w-24" placeholder="Lat" />
                  <input type="number" step="any" value={editingAttendance.location_lng || ''} onChange={e => setEditingAttendance(a => ({ ...a, location_lng: e.target.value }))} className="input input-bordered w-24" placeholder="Lng" />
                  <button type="button" className="btn-primary" onClick={handleUpdateAttendance}>Guardar</button>
                  <button type="button" className="btn-secondary" onClick={() => setEditingAttendance(null)}>Cancelar</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'PLANILLA' && (
        <div className="w-full max-w-4xl space-y-6">
          {!isAdmin ? (
            <div className="bg-white rounded shadow p-4 text-sm text-gray-600">Solo admin puede ver planilla.</div>
          ) : (
            <>
              <div className="bg-white rounded shadow p-4">
                <h2 className="font-bold mb-3">Planilla semanal</h2>
                <div className="flex flex-wrap gap-2 items-center">
                  <input type="date" value={payrollStart} onChange={(e) => setPayrollStart(e.target.value)} className="input input-bordered" title="Inicio" aria-label="Inicio" />
                  <input type="date" value={payrollEnd} onChange={(e) => setPayrollEnd(e.target.value)} className="input input-bordered" title="Fin" aria-label="Fin" />
                  <button type="button" className="btn-secondary" onClick={refreshPayrollAttendance} disabled={loadingPayrollAttendance}>
                    {loadingPayrollAttendance ? 'Cargando...' : 'Cargar asistencias'}
                  </button>
                  <button type="button" className="btn-primary" onClick={downloadPayrollPdf}>
                    Exportar PDF
                  </button>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Registros cargados: {payrollAttendanceRows.length}
                </div>
              </div>

              <div className="bg-white rounded shadow p-4">
                <h2 className="font-bold mb-3">Resumen</h2>
                <table className="table-auto w-full text-xs">
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Puesto</th>
                      <th>Proyecto</th>
                      <th>Días</th>
                      <th>Min. trabajados</th>
                      <th>Q/día</th>
                      <th>Total (Q)</th>
                      <th>Descuento (Q)</th>
                      <th>Min. fuera</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollPreviewRows.map((r) => (
                      <tr key={r.employeeId}>
                        <td>{r.employee}</td>
                        <td>{r.position}</td>
                        <td>{r.projectName || '—'}</td>
                        <td className="text-center">{r.daysWorked}</td>
                        <td className="text-right">{r.minutesWorked}</td>
                        <td className="text-right">{(Math.round(r.dailyRate * 100) / 100).toFixed(2)}</td>
                        <td className="text-right">{(Math.round(r.total * 100) / 100).toFixed(2)}</td>
                        <td className="text-right">{(Math.round(r.discount * 100) / 100).toFixed(2)}</td>
                        <td className="text-right">{r.minutesOutside}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 font-bold">TOTAL GENERAL: Q{(Math.round(payrollGrandTotal * 100) / 100).toFixed(2)}</div>
              </div>
            </>
          )}
        </div>
      )}

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

export function useRealtimeAttendance(onNewAttendance: (row: any) => void): void {
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