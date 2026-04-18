/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Comma-separated parent origins allowed to embed this vault (e.g. https://main-app.vercel.app) */
  readonly VITE_ALLOWED_PARENT_ORIGINS?: string;
  readonly VITE_VAULT_SHARED_SECRET?: string;
  readonly VITE_VAULT_PROTOCOL_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
