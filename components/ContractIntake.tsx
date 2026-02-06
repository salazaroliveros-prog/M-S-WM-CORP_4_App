import React, { useMemo, useState } from 'react';
import { FileText, Copy, Send } from 'lucide-react';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { submitEmployeeContractResponsePublic } from '../lib/db';

type IntakeSeed = {
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

type IntakeResponse = IntakeSeed & {
  dpi: string;
  phone: string;
  address: string;
  startDate: string;
  emergencyContact: string;
  accepted: boolean;
  responseAt: string;
};

const isLikelyUuid = (s: string) => {
  const v = String(s || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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

const ContractIntake: React.FC = () => {
  const seed = useMemo(() => {
    const rawHash = window.location.hash || '';
    const m = rawHash.match(/#contract-intake=([^&]+)/);
    if (!m?.[1]) return null;
    try {
      const json = base64UrlDecode(m[1]);
      const parsed = JSON.parse(json) as IntakeSeed;
      if (!parsed?.employeeName || !parsed?.role || !parsed?.requestId) return null;
      if (!isLikelyUuid(parsed.requestId)) return null;
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const [dpi, setDpi] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [startDate, setStartDate] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [cloudSubmitStatus, setCloudSubmitStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [cloudSubmitError, setCloudSubmitError] = useState<string>('');

  const responseCode = useMemo(() => {
    if (!seed) return '';
    const payload: IntakeResponse = {
      ...seed,
      dpi: dpi.trim(),
      phone: phone.trim(),
      address: address.trim(),
      startDate: startDate.trim(),
      emergencyContact: emergencyContact.trim(),
      accepted,
      responseAt: new Date().toISOString(),
    };
    return base64UrlEncode(JSON.stringify(payload));
  }, [seed, dpi, phone, address, startDate, emergencyContact, accepted]);

  const canSubmit = useMemo(() => {
    if (!seed) return false;
    if (!accepted) return false;
    if (!dpi.trim()) return false;
    if (!phone.trim()) return false;
    if (!startDate.trim()) return false;
    return true;
  }, [seed, accepted, dpi, phone, startDate]);

  const tryCloudSubmit = async () => {
    if (!seed) return false;
    if (!canSubmit) return false;
    if (!isSupabaseConfigured) return false;
    if (cloudSubmitStatus === 'sent') return true;

    setCloudSubmitStatus('sending');
    setCloudSubmitError('');
    try {
      const payload: IntakeResponse = {
        ...seed,
        dpi: dpi.trim(),
        phone: phone.trim(),
        address: address.trim(),
        startDate: startDate.trim(),
        emergencyContact: emergencyContact.trim(),
        accepted,
        responseAt: new Date().toISOString(),
      };
      await submitEmployeeContractResponsePublic({ requestId: seed.requestId, response: payload });
      setCloudSubmitStatus('sent');
      return true;
    } catch (e: any) {
      setCloudSubmitStatus('error');
      setCloudSubmitError(String(e?.message || 'No se pudo enviar automáticamente a RRHH.'));
      return false;
    }
  };

  const handleCopy = async () => {
    await tryCloudSubmit();
    try {
      await navigator.clipboard.writeText(responseCode);
      alert('Código copiado. Envíalo a RRHH para registrar tu contrato.');
    } catch {
      alert('No se pudo copiar automáticamente. Selecciona el texto y copia manualmente.');
    }
  };

  const handleSendWhatsApp = () => {
    if (!seed) return;
    if (!canSubmit) {
      alert('Completa los datos obligatorios y acepta los términos.');
      return;
    }
    // Best effort: also submit directly to RRHH/Supabase.
    // WhatsApp remains a fallback and also provides a human-friendly trace.
    void tryCloudSubmit();
    const msg = [
      `${seed.companyName}`,
      'CONTRATO - RESPUESTA',
      '',
      `Empleado: ${seed.employeeName}`,
      `Puesto: ${seed.role}`,
      `Salario: Q${seed.dailyRate}/día`,
      '',
      'Código de respuesta (pegar en RRHH → Importar):',
      responseCode,
    ].join('\n');
    const link = buildWhatsAppLink(null, msg);
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  if (!seed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-xl">
          <div className="flex items-center gap-2 font-bold text-navy-900 mb-2">
            <FileText className="text-mustard-500" />
            Contrato
          </div>
          <p className="text-sm text-gray-600">Link inválido o incompleto. Solicita un nuevo link a RRHH.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center gap-2 font-bold text-navy-900 text-lg">
            <FileText className="text-mustard-500" />
            Contrato Digital - Datos del Colaborador
          </div>
          <div className="text-xs text-gray-500 mt-1">Solicitud: {new Date(seed.requestedAt).toLocaleString()} • ID: {seed.requestId}</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm">
            <div className="p-3 bg-gray-50 rounded border">
              <div className="text-xs text-gray-500">Empresa</div>
              <div className="font-semibold">{seed.companyName}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded border">
              <div className="text-xs text-gray-500">Proyecto</div>
              <div className="font-semibold">{seed.projectName || '-'}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded border">
              <div className="text-xs text-gray-500">Empleado</div>
              <div className="font-semibold">{seed.employeeName}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded border">
              <div className="text-xs text-gray-500">Puesto / Salario</div>
              <div className="font-semibold">{seed.role} • Q{seed.dailyRate}/día</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1" htmlFor="intake-dpi">DPI / CUI *</label>
              <input id="intake-dpi" className="w-full p-2 border rounded" value={dpi} onChange={e => setDpi(e.target.value)} placeholder="Ej: 1234 56789 0101" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1" htmlFor="intake-phone">Teléfono (WhatsApp) *</label>
              <input id="intake-phone" className="w-full p-2 border rounded" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ej: +502 5555 5555" inputMode="tel" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-600 mb-1" htmlFor="intake-address">Dirección</label>
              <input id="intake-address" className="w-full p-2 border rounded" value={address} onChange={e => setAddress(e.target.value)} placeholder="Dirección completa" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1" htmlFor="intake-start">Fecha inicio *</label>
              <input id="intake-start" type="date" className="w-full p-2 border rounded" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1" htmlFor="intake-emergency">Contacto emergencia</label>
              <input id="intake-emergency" className="w-full p-2 border rounded" value={emergencyContact} onChange={e => setEmergencyContact(e.target.value)} placeholder="Nombre y teléfono" />
            </div>
          </div>

          <label className="flex items-center gap-2 mt-4 text-sm text-gray-700">
            <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
            Confirmo que la información es correcta y autorizo su uso para el contrato.
          </label>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="font-bold text-navy-900 mb-2">Enviar respuesta a RRHH</div>
          <p className="text-sm text-gray-600 mb-3">Copia el código y envíalo a RRHH (WhatsApp) para registrar tu contrato.</p>

          {isSupabaseConfigured && (
            <div className="text-xs border rounded p-2 mb-3 bg-gray-50">
              <div className="font-semibold text-gray-700">Envío automático a RRHH</div>
              <div className="text-gray-600">
                Estado: {cloudSubmitStatus === 'idle' ? 'pendiente' : cloudSubmitStatus === 'sending' ? 'enviando…' : cloudSubmitStatus === 'sent' ? 'enviado' : 'error'}
              </div>
              {cloudSubmitStatus === 'error' && cloudSubmitError && (
                <div className="text-amber-700 mt-1">{cloudSubmitError}</div>
              )}
              {cloudSubmitStatus === 'sent' && (
                <div className="text-green-700 mt-1">RRHH debería ver tu contrato como “Recibido”.</div>
              )}
            </div>
          )}

          <label htmlFor="intake-code" className="block text-xs text-gray-600 mb-1">Código</label>
          <textarea
            id="intake-code"
            className="w-full p-2 border rounded text-xs font-mono"
            rows={6}
            readOnly
            value={responseCode}
            title="Código de respuesta"
            aria-label="Código de respuesta"
            placeholder="Se generará al completar los datos"
          />

          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <button
              className="flex items-center justify-center gap-2 px-4 py-2 rounded bg-navy-900 text-white hover:bg-navy-800 disabled:opacity-50"
              onClick={handleCopy}
              disabled={!canSubmit}
              title="Copiar código"
            >
              <Copy size={16} /> Copiar código
            </button>
            <button
              className="flex items-center justify-center gap-2 px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              onClick={handleSendWhatsApp}
              disabled={!canSubmit}
              title="Abrir WhatsApp"
            >
              <Send size={16} /> Enviar por WhatsApp
            </button>
          </div>
          {!canSubmit && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
              Completa los campos obligatorios (*) y acepta la confirmación para habilitar el envío.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContractIntake;
