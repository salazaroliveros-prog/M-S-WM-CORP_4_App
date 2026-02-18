import React, { useEffect, useState, useRef } from 'react';
import { fetchNotifications, markNotificationAsRead } from '../lib/notifications';
import { getSupabaseClient } from '../lib/supabaseClient';
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
  orgId: string;
}

const Notifications: React.FC<Props> = ({ orgId }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNotifications = async () => {
    setLoading(true);
    try {
      const data = await fetchNotifications(orgId);
      setNotifications(data);
    } catch (e: any) {
      toast.error('Error cargando notificaciones');
    } finally {
      setLoading(false);
    }
  };


  // Real-time subscription for notifications
  useEffect(() => {
    loadNotifications();
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('notifications-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `org_id=eq.${orgId}` }, payload => {
        // Prepend new notification
        setNotifications(prev => [payload.new as Notification, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const handleMarkAsRead = async (id: string) => {
    try {
      await markNotificationAsRead(id);
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch (e: any) {
      toast.error('No se pudo marcar como leída');
    }
  };

  return (
    <div>
      <h3>Notificaciones</h3>
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
