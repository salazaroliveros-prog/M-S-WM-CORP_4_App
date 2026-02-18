import { getSupabaseClient } from './supabaseClient';

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
