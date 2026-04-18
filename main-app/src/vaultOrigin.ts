/**
 * Vault iframe base URL (origin only, no path).
 * Local: http://localhost:5173 · Production: set VITE_VAULT_ORIGIN on Vercel.
 */
export function getVaultOrigin(): string {
  const raw = import.meta.env.VITE_VAULT_ORIGIN as string | undefined;
  const base = (raw?.trim() || "http://localhost:5173").replace(/\/+$/, "");
  return base || "http://localhost:5173";
}

/** Short label for footer (hostname). */
export function vaultDisplayHost(): string {
  try {
    return new URL(getVaultOrigin()).host;
  } catch {
    return getVaultOrigin();
  }
}
