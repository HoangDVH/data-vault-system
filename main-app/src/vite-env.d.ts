/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VAULT_ORIGIN?: string;
  readonly VITE_VAULT_SHARED_SECRET?: string;
  readonly VITE_VAULT_PROTOCOL_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
