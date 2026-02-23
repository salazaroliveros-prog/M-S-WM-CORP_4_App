import React, { useEffect, useState } from 'react';
import { fetchNotifications, markNotificationAsRead } from '../lib/notifications';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { ensurePushEnabled, getPushStatus, isPushSupported } from '../lib/push';
import { toast } from 'react-toastify';

interface Notification {
  id: string;
  org_id: string;
  employee_id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
}

interface Props {
  orgId?: string | null;
  useCloud?: boolean;
}

const LOCAL_NOTIFICATIONS_KEY = 'wm_offline_notifications_v1';

function readLocalNotifications(): Notification[] {
  try {
    const raw = localStorage.getItem(LOCAL_NOTIFICATIONS_KEY);
    const rows: any[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r && typeof r === 'object' && typeof (r as any).id === 'string')
      .map((r) => ({
        id: String((r as any).id),
        org_id: String((r as any).org_id ?? ''),
        employee_id: String((r as any).employee_id ?? ''),
        type: String((r as any).type ?? ''),
        message: String((r as any).message ?? ''),
        read: Boolean((r as any).read),
        created_at: String((r as any).created_at ?? new Date().toISOString()),
      }));
  } catch {
    return [];
  }
}

function writeLocalNotifications(rows: Notification[]) {
  try {
    localStorage.setItem(LOCAL_NOTIFICATIONS_KEY, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

function mergeNotifications(prefer: Notification[], alsoKeep: Notification[]): Notification[] {
  const keyOf = (n: Notification) => `${n.type}::${n.message}`;
  const seen = new Set<string>();
  const out: Notification[] = [];
  for (const n of prefer) {
    const k = keyOf(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  for (const n of alsoKeep) {
    const k = keyOf(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

const Notifications: React.FC<Props> = ({ orgId = null, useCloud = false }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<string>('default');
  const [pushSubscribed, setPushSubscribed] = useState(false);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      if (useCloud && isSupabaseConfigured && orgId) {
        const data = await fetchNotifications(orgId);
        const local = readLocalNotifications().filter((n) => n.org_id === String(orgId));
        const merged = mergeNotifications(data, local);
        setNotifications(merged);
        writeLocalNotifications(merged);
      } else {
        const local = readLocalNotifications();
        const filtered = orgId ? local.filter((n) => n.org_id === String(orgId)) : local;
        setNotifications(filtered);
      }
    } catch (e: any) {
      const local = readLocalNotifications();
      const filtered = orgId ? local.filter((n) => n.org_id === String(orgId)) : local;
      setNotifications(filtered);
      toast.error('Error cargando notificaciones (mostrando caché local)');
    } finally {
      setLoading(false);
    }
  };


  // Real-time subscription for notifications (cloud only)
  useEffect(() => {
    loadNotifications();
    if (!useCloud || !isSupabaseConfigured || !orgId) return;

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('notifications-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `org_id=eq.${orgId}` }, payload => {
        setNotifications((prev) => {
          const next = [payload.new as Notification, ...prev];
          writeLocalNotifications(next);
          return next;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, useCloud]);

  useEffect(() => {
    const run = async () => {
      try {
        setPushSupported(isPushSupported());
        if (!isPushSupported()) return;
        const s = await getPushStatus();
        setPushPermission(String(s.permission));
        setPushSubscribed(Boolean(s.subscribed));
      } catch {
        // ignore
      }
    };
    void run();
  }, [orgId, useCloud]);

  const handleEnablePush = async () => {
    if (!orgId) {
      toast.error('No hay organización activa');
      return;
    }
    setPushLoading(true);
    try {
      await ensurePushEnabled({ orgId: String(orgId) });
      const s = await getPushStatus();
      setPushPermission(String(s.permission));
      setPushSubscribed(Boolean(s.subscribed));
      toast.success('Notificaciones push activadas en este dispositivo');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo activar push');
    } finally {
      setPushLoading(false);
    }
  };

  const handleMarkAsRead = async (id: string) => {
    try {
      const isCloud = Boolean(useCloud && isSupabaseConfigured && orgId);
      if (isCloud) {
        await markNotificationAsRead(id);
      }
      setNotifications((prev) => {
        const next = prev.map((n) => n.id === id ? { ...n, read: true } : n);
        writeLocalNotifications(next);
        return next;
      });
    } catch (e: any) {
      toast.error('No se pudo marcar como leída');
    }
  };

  return (
    <div>
      <h3>Notificaciones</h3>
      {useCloud && isSupabaseConfigured && orgId && (
        <div className="bg-white rounded-xl shadow p-4 mb-4">
          <div className="text-sm font-semibold text-gray-700">Notificaciones del dispositivo (Push)</div>
          {!pushSupported ? (
            <div className="text-xs text-gray-500 mt-1">Este navegador/dispositivo no soporta Push.</div>
          ) : (
            <div className="text-xs text-gray-600 mt-1">
              Permiso: <span className="font-semibold">{pushPermission}</span> · Estado: <span className="font-semibold">{pushSubscribed ? 'Suscrito' : 'No suscrito'}</span>
            </div>
          )}
          <div className="mt-3">
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={!pushSupported || pushLoading}
              className="bg-navy-900 hover:bg-navy-800 disabled:bg-gray-300 text-white font-semibold py-2 px-4 rounded-lg"
              title="Activar notificaciones push"
            >
              {pushLoading ? 'Activando...' : 'Activar Push'}
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Requiere HTTPS (o localhost) y que la función Supabase esté desplegada.
          </div>
        </div>
      )}
      {!useCloud && (
        <div className="text-xs text-gray-500 mb-2">Modo local: mostrando notificaciones guardadas en este dispositivo.</div>
      )}
      {loading ? (
        <div>Cargando...</div>
      ) : notifications.length === 0 ? (
        <div>No hay notificaciones.</div>
      ) : (
        <ul>
          {notifications.map((n) => (
            <li
              key={n.id}
              className={n.read ? 'notification-item read' : 'notification-item'}
            >
              <span>{n.message}</span>
              {!n.read && (
                <button
                  onClick={() => handleMarkAsRead(n.id)}
                  className="mark-read-btn"
                >
                  Marcar como leída
                </button>
              )}
              <span className="notification-date">
                {new Date(n.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Notifications;
