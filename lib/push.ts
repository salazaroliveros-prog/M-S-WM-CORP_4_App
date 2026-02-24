import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function resolveVapidPublicKey(): Promise<string> {
  const fromEnv = String((import.meta as any).env?.VITE_WEB_PUSH_PUBLIC_KEY ?? '').trim();
  if (fromEnv) return fromEnv;

  // Fallback: fetch from Supabase Edge Function (useful for deployed builds where
  // client env vars aren't injected).
  if (!isSupabaseConfigured) return '';
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('push', {
      body: { action: 'publicKey' },
    });
    if (error) throw error;
    const key = String((data as any)?.publicKey ?? '').trim();
    return key;
  } catch {
    return '';
  }
}

export async function getPushStatus() {
  if (!isPushSupported()) {
    return { supported: false, permission: 'unsupported' as const, subscribed: false };
  }
  const permission = Notification.permission;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return { supported: true, permission, subscribed: !!sub };
}

export async function ensurePushEnabled(input: { orgId: string }) {
  if (!isPushSupported()) throw new Error('Este dispositivo no soporta notificaciones push.');
  if (!isSupabaseConfigured) throw new Error('Supabase no está configurado; push requiere modo nube.');
  if (!input.orgId) throw new Error('orgId requerido');

  const vapidPublicKey = await resolveVapidPublicKey();
  if (!vapidPublicKey) {
    throw new Error('No se pudo obtener la VAPID public key (configure VITE_WEB_PUSH_PUBLIC_KEY o despliegue la función Supabase "push").');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permiso de notificaciones no otorgado.');
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  const json = subscription.toJSON() as any;
  const endpoint = String(json?.endpoint ?? subscription.endpoint ?? '').trim();
  const p256dh = String(json?.keys?.p256dh ?? '').trim();
  const auth = String(json?.keys?.auth ?? '').trim();
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Suscripción push incompleta (endpoint/keys)');
  }

  const supabase = getSupabaseClient();
  const userRes = await supabase.auth.getUser();
  const userId = userRes.data?.user?.id;
  if (!userId) {
    throw new Error('No hay sesión de usuario en Supabase; inicia sesión en nube para registrar push.');
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        org_id: input.orgId,
        user_id: userId,
        endpoint,
        p256dh,
        auth,
      },
      { onConflict: 'org_id,endpoint' }
    );
  if (error) throw error;

  return { subscribed: true };
}

export async function disablePush(input: { orgId: string }) {
  if (!isPushSupported()) return;
  if (!isSupabaseConfigured) return;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = String((sub.toJSON() as any)?.endpoint ?? sub.endpoint ?? '').trim();

  const supabase = getSupabaseClient();
  try {
    await supabase.from('push_subscriptions').delete().eq('org_id', input.orgId).eq('endpoint', endpoint);
  } catch {
    // ignore
  }

  try {
    await sub.unsubscribe();
  } catch {
    // ignore
  }
}
