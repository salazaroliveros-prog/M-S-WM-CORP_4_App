import { getSupabaseClient } from './supabaseClient';

export async function createNotification(input: {
  orgId: string;
  employeeId?: string | null;
  type: string;
  message: string;
}) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('notifications')
    .insert([
      {
        org_id: input.orgId,
        employee_id: input.employeeId ?? null,
        type: input.type,
        message: input.message,
      },
    ]);
  if (error) throw error;

  // Best-effort push notification (does not fail the main flow)
  try {
    await supabase.functions.invoke('push', {
      body: {
        orgId: input.orgId,
        title: 'Notificación',
        body: input.message,
        data: { type: input.type },
      },
    });
  } catch {
    // ignore
  }
}

export async function notifyAttendance(orgId: string, employeeId: string, message: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('notifications')
    .insert([
      {
        org_id: orgId,
        employee_id: employeeId,
        type: 'asistencia',
        message,
      }
    ]);
  if (error) throw error;

  try {
    await supabase.functions.invoke('push', {
      body: {
        orgId,
        title: 'Asistencia',
        body: message,
        data: { type: 'asistencia' },
      },
    });
  } catch {
    // ignore
  }
}

export async function markNotificationAsRead(notificationId: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId);
  if (error) throw error;
}

export async function fetchNotifications(orgId: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
