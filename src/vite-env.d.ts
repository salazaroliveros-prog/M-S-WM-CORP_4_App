// Vite environment type declarations for TypeScript
// Adds `import.meta.env` typings used across the app
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  // allow other VITE_... env vars without error
  readonly [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
