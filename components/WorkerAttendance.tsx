import React, { useEffect, useMemo, useState } from 'react';
import { Fingerprint, LogIn, LogOut, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { getAttendanceTokenInfo, submitAttendanceWithToken, webauthnInvoke } from '../lib/db';

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

type GeoState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  lat?: number;
  lng?: number;
  accuracyM?: number;
  error?: string;
};

const WorkerAttendance: React.FC = () => {
  const parseTokenFromHash = () => {
    const raw = window.location.hash || '';
    const m = raw.match(/#asistencia=([^&]+)/);
    return m?.[1] ? decodeURIComponent(m[1]) : '';
  };

  const [token, setToken] = useState<string>(() => {
    const fromHash = parseTokenFromHash();
    if (fromHash) return fromHash;
    try {
      const cached = localStorage.getItem('wm_worker_attendance_token_last');
      return cached ? String(cached) : '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    const fromHash = parseTokenFromHash();
    if (!fromHash) return;
    setToken(fromHash);
    try {
      localStorage.setItem('wm_worker_attendance_token_last', fromHash);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [workDate] = useState<string>(todayISO());
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const isWebAuthnUsable = useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (typeof PublicKeyCredential === 'undefined') return false;
    // WebAuthn requires a secure context (HTTPS), but localhost is treated as secure.
    if (!(window as any).isSecureContext) return false;
    return true;
  }, []);

  const [biometricMode, setBiometricMode] = useState<'phone' | 'code'>(() => {
    return (typeof window !== 'undefined' && (window as any).isSecureContext && typeof PublicKeyCredential !== 'undefined') ? 'phone' : 'code';
  });
  const [biometricCode, setBiometricCode] = useState('');
  const [employeeName, setEmployeeName] = useState<string>('');
  const [webauthnStatus, setWebauthnStatus] = useState<{ credentialCount: number; rpId: string } | null>(null);
  const [webauthnBusy, setWebauthnBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<any | null>(null);

  const canUseGeolocation = typeof navigator !== 'undefined' && !!navigator.geolocation;

  const isStandalone = useMemo(() => {
    try {
      const w = window as any;
      const iosStandalone = typeof w?.navigator?.standalone === 'boolean' ? Boolean(w.navigator.standalone) : false;
      const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
      const standalone = Boolean(mql?.matches);
      return iosStandalone || standalone;
    } catch {
      return false;
    }
  }, []);

  const deviceInfo = useMemo(() => {
    try {
      return {
        userAgent: navigator.userAgent,
        platform: (navigator as any).userAgentData?.platform ?? null,
        language: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    } catch {
      return { userAgent: null };
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const info = await getAttendanceTokenInfo(token);
        if (info?.employeeName) setEmployeeName(info.employeeName);
      } catch {
        // ignore
      }
    })();
  }, [token]);

  useEffect(() => {
    // If user is in an insecure context, force fallback to code.
    if (biometricMode === 'phone' && !isWebAuthnUsable) {
      setBiometricMode('code');
    }
  }, [biometricMode, isWebAuthnUsable]);

  useEffect(() => {
    // Keep worker UX simple: prefer phone biometrics when available, otherwise fall back to code.
    setBiometricMode(isWebAuthnUsable ? 'phone' : 'code');
  }, [isWebAuthnUsable]);

  useEffect(() => {
    // Reduce friction: prompt for GPS as soon as the worker opens the app.
    if (geo.status === 'idle' && canUseGeolocation) {
      requestLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshWebauthnStatus = async () => {
    if (!isWebAuthnUsable) {
      setWebauthnStatus(null);
      return;
    }
    try {
      const res = await webauthnInvoke('status', { token });
      setWebauthnStatus({ credentialCount: Number(res?.credentialCount ?? 0), rpId: String(res?.rpId ?? '') });
      if (res?.employeeName && !employeeName) setEmployeeName(String(res.employeeName));
    } catch {
      setWebauthnStatus(null);
    }
  };

  useEffect(() => {
    refreshWebauthnStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleRegisterBiometric = async () => {
    if (!isWebAuthnUsable) {
      alert('La biometría del teléfono requiere HTTPS (o localhost) y un navegador compatible.');
      return;
    }
    setWebauthnBusy(true);
    try {
      const { options } = await webauthnInvoke('registration_options', { token });
      const attResp = await startRegistration(options);
      const verified = await webauthnInvoke('registration_verify', { token, response: attResp, deviceLabel: 'Teléfono' });
      if (!verified?.verified) {
        alert('No se pudo registrar biometría.');
        return;
      }
      alert('Biometría registrada.');
      await refreshWebauthnStatus();
    } catch (e: any) {
      alert(e?.message || 'Error registrando biometría');
    } finally {
      setWebauthnBusy(false);
    }
  };

  const verifyBiometric = async (): Promise<{ credentialId: string } | null> => {
    if (!isWebAuthnUsable) return null;
    const { options } = await webauthnInvoke('authentication_options', { token });
    const asseResp = await startAuthentication(options);
    const verified = await webauthnInvoke('authentication_verify', { token, response: asseResp });
    if (!verified?.verified || !verified?.credentialId) return null;
    return { credentialId: String(verified.credentialId) };
  };

  const requestLocation = async () => {
    if (!canUseGeolocation) {
      setGeo({ status: 'error', error: 'Este dispositivo no soporta GPS (Geolocation API).' });
      return;
    }

    setGeo({ status: 'loading' });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          status: 'ready',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
      },
      (err) => {
        setGeo({ status: 'error', error: err.message || 'No se pudo obtener ubicación.' });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSubmit = async (action: 'check_in' | 'check_out') => {
    if (!token) {
      alert('Link inválido: falta el token (#asistencia=...).');
      return;
    }
    if (geo.status !== 'ready' || geo.lat === undefined || geo.lng === undefined) {
      alert('Obtén tu ubicación GPS primero.');
      return;
    }

    if (biometricMode === 'code' && !biometricCode.trim()) {
      alert('Ingresa el código biométrico.');
      return;
    }

    setSending(true);
    try {
      let biometricPayload: any = null;
      if (biometricMode === 'code') {
        biometricPayload = { method: 'code', code: biometricCode.trim(), capturedAt: new Date().toISOString() };
      } else {
        setWebauthnBusy(true);
        const verified = await verifyBiometric();
        setWebauthnBusy(false);
        if (!verified) {
          alert('No se pudo verificar biometría del teléfono.');
          return;
        }
        biometricPayload = {
          method: 'webauthn',
          verified: true,
          credentialId: verified.credentialId,
          verifiedAt: new Date().toISOString(),
        };
      }

      const res = await submitAttendanceWithToken({
        token,
        action,
        workDate,
        lat: geo.lat,
        lng: geo.lng,
        accuracyM: geo.accuracyM ?? null,
        biometric: biometricPayload,
        device: deviceInfo,
      });

      setLastResult(res);
      alert(action === 'check_in' ? 'Entrada registrada.' : 'Salida registrada.');
    } catch (e: any) {
      alert(e?.message || 'No se pudo registrar asistencia');
    } finally {
      setSending(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-xl">
          <div className="font-bold text-navy-900 text-lg mb-2">Asistencia</div>
          <div className="text-sm text-gray-600">Link inválido o incompleto. Solicita un nuevo link a RRHH.</div>
        </div>
      </div>
    );
  }

  const handleRefresh = async () => {
    await Promise.all([
      (async () => requestLocation())(),
      (async () => refreshWebauthnStatus())(),
    ]);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-bold text-navy-900 text-lg">Asistencia (GPS + Biométrico)</div>
              <div className="text-xs text-gray-500">Marca tu entrada/salida. El sistema registra tu GPS y una evidencia biométrica (teléfono o código de lector).</div>
              {employeeName && <div className="text-xs text-gray-500 mt-1">Trabajador: <span className="font-semibold">{employeeName}</span></div>}
            </div>
            <button
              type="button"
              className="px-3 py-2 rounded border bg-white hover:bg-gray-50 flex items-center gap-2 text-sm disabled:opacity-50"
              onClick={handleRefresh}
              disabled={geo.status === 'loading' || webauthnBusy}
              title="Actualizar asistencia"
            >
              <RefreshCw size={16} /> Asistencia
            </button>
          </div>

          {!isStandalone && (
            <div className="mt-3 text-xs bg-gray-50 border rounded p-2">
              <div className="font-semibold text-gray-700">Instalar app (recomendado)</div>
              <div className="text-gray-600">
                Si tu navegador muestra “Instalar” o “Agregar a la pantalla de inicio”, selecciónalo para usar la app como aplicación.
              </div>
            </div>
          )}

          <div className="mt-4 text-xs text-gray-600">
            Fecha: <span className="font-semibold">{workDate}</span>
          </div>

          {!isWebAuthnUsable && (
            <div className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              La biometría del teléfono (WebAuthn) requiere ejecutar la app en contexto seguro: <span className="font-semibold">HTTPS</span> (localhost también sirve). Se usará <span className="font-semibold">Código de lector</span>.
            </div>
          )}

          {biometricMode === 'phone' && isWebAuthnUsable && (
            <div className="mt-4 p-3 rounded border bg-gray-50 text-sm">
              <div className="flex items-center gap-2 font-semibold text-navy-900">
                <ShieldCheck size={16} className="text-mustard-500" /> Biometría del teléfono (WebAuthn)
              </div>
              <div className="text-xs text-gray-600 mt-1">Requiere HTTPS y un dispositivo con biometría configurada.</div>
              <div className="text-xs text-gray-600 mt-1">
                Credenciales registradas: <span className="font-semibold">{webauthnStatus ? webauthnStatus.credentialCount : '—'}</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <button
                  type="button"
                  className="px-4 py-2 rounded bg-white border hover:bg-gray-50 text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                  onClick={handleRegisterBiometric}
                  disabled={webauthnBusy}
                  title="Registrar biometría"
                >
                  <UserPlus size={16} /> Registrar biometría
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded bg-white border hover:bg-gray-50 text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                  onClick={refreshWebauthnStatus}
                  disabled={webauthnBusy}
                  title="Actualizar estado"
                >
                  <RefreshCw size={16} /> Actualizar
                </button>
              </div>
              {webauthnStatus && webauthnStatus.credentialCount === 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
                  Debes registrar la biometría una vez antes de marcar asistencia.
                </div>
              )}
            </div>
          )}

          {biometricMode === 'code' && (
            <div className="mt-4">
              <label className="block text-xs text-gray-600 mb-1" htmlFor="wa-bio">Código biométrico (lector) *</label>
              <div className="relative">
                <Fingerprint className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  id="wa-bio"
                  className="w-full p-2 pl-8 border rounded"
                  value={biometricCode}
                  onChange={e => setBiometricCode(e.target.value)}
                  placeholder="Ej: ID o código del lector"
                  title="Código biométrico"
                />
              </div>
              <div className="text-[11px] text-gray-500 mt-1">Si el lector entrega un código, ingrésalo para guardarlo como evidencia.</div>
            </div>
          )}

          <div className="mt-4 p-3 rounded border bg-gray-50 text-sm">
            <div className="font-semibold text-navy-900">GPS</div>
            {geo.status === 'idle' && <div className="text-gray-600">Solicitando ubicación…</div>}
            {geo.status === 'loading' && <div className="text-gray-600">Obteniendo ubicación…</div>}
            {geo.status === 'error' && <div className="text-red-600">{geo.error}</div>}
            {geo.status === 'ready' && <div className="text-gray-700">Ubicación lista{geo.accuracyM ? ` (±${Math.round(geo.accuracyM)}m)` : ''}.</div>}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <button
              type="button"
              className="flex-1 bg-navy-900 text-white px-4 py-2 rounded font-bold hover:bg-navy-800 disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={() => handleSubmit('check_in')}
              disabled={sending || (biometricMode === 'phone' && (webauthnStatus?.credentialCount ?? 0) === 0) || webauthnBusy}
              title="Marcar entrada"
            >
              <LogIn size={16} /> Marcar entrada
            </button>
            <button
              type="button"
              className="flex-1 bg-gray-800 text-white px-4 py-2 rounded font-bold hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-2"
              onClick={() => handleSubmit('check_out')}
              disabled={sending || (biometricMode === 'phone' && (webauthnStatus?.credentialCount ?? 0) === 0) || webauthnBusy}
              title="Marcar salida"
            >
              <LogOut size={16} /> Marcar salida
            </button>
          </div>

          {lastResult && (
            <div className="mt-4 text-xs text-gray-600">
              Último registro: {lastResult.work_date ?? ''} • {lastResult.check_in ? `Entrada: ${new Date(lastResult.check_in).toLocaleTimeString()}` : ''}{' '}
              {lastResult.check_out ? `• Salida: ${new Date(lastResult.check_out).toLocaleTimeString()}` : ''}
              {(lastResult.location_lat != null || lastResult.location_lng != null) && (
                <span>
                  {' '}• GPS: {Number(lastResult.location_lat).toFixed(6)}, {Number(lastResult.location_lng).toFixed(6)}
                  {lastResult.accuracy_m ? ` (±${Math.round(Number(lastResult.accuracy_m))}m)` : ''}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="text-xs text-gray-500">
          Nota: Para que funcione, RRHH debe generar el link de asistencia y Supabase debe tener aplicada la migración de asistencia/token.
        </div>
      </div>
    </div>
  );
};

export default WorkerAttendance;
