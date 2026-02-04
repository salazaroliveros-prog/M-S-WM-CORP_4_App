import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const metaEnv = (import.meta as any).env as Record<string, any> | undefined;
const env = metaEnv ?? (process.env as Record<string, any> | undefined) ?? {};

const supabaseUrl = (env.VITE_SUPABASE_URL as string | undefined) ?? undefined;
const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let client: SupabaseClient | null = null;

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function createMemoryStorage(): StorageLike {
  const store: Record<string, string> = {};
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
  };
}

export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase no configurado. Defina VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local'
    );
  }

  if (!client) {
    const isBrowser = typeof window !== 'undefined';
    const memoryStorage = !isBrowser ? createMemoryStorage() : undefined;
    client = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: isBrowser,
        detectSessionInUrl: isBrowser,
        storage: memoryStorage as any,
      },
    });
  }

  return client;
}
