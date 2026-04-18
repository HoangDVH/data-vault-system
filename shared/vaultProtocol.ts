/**
 * Shared vault iframe wire protocol: version, HMAC integrity, timestamp skew,
 * and payload validation. Keep in sync between main-app and data-vault.
 */

export const PROTOCOL_VERSION = 1 as const;

/** Reject messages older/newer than this skew (replay / clock drift window). */
export const TIMESTAMP_MAX_SKEW_MS = 10 * 60 * 1000;

const DEV_FALLBACK_SECRET =
  "__VAULT_DEV_SHARED_KEY_ROTATE_FOR_PRODUCTION__";

/** Set `VITE_VAULT_PROTOCOL_DEBUG=true` in .env to log verify / origin rejections. */
export function isVaultProtocolDebugEnabled(): boolean {
  return import.meta.env?.VITE_VAULT_PROTOCOL_DEBUG === "true";
}

export function vaultProtocolDebug(
  source: "main-app" | "data-vault",
  message: string,
  extra?: unknown,
): void {
  if (!isVaultProtocolDebugEnabled()) return;
  if (extra !== undefined) {
    console.warn(`[vault-protocol:${source}]`, message, extra);
  } else {
    console.warn(`[vault-protocol:${source}]`, message);
  }
}

export type WireMessageType = "INIT" | "GET_DATA" | "SEARCH" | "BULK_INSERT";

const WIRE_TYPES = new Set<string>([
  "INIT",
  "GET_DATA",
  "SEARCH",
  "BULK_INSERT",
]);

export type VaultWireRequest = {
  v: number;
  id: string;
  type: WireMessageType;
  payload?: unknown;
  ts: number;
  sig: string;
};

export type VaultWireResponse = {
  v: number;
  id: string;
  success: boolean;
  payload?: unknown;
  error?: string;
  ts: number;
  sig: string;
};

function getSharedSecretString(): string {
  const env = import.meta.env?.VITE_VAULT_SHARED_SECRET as string | undefined;
  const s = env?.trim();
  return s && s.length > 0 ? s : DEV_FALLBACK_SECRET;
}

let hmacKeyPromise: Promise<CryptoKey> | null = null;

function getHmacKey(): Promise<CryptoKey> {
  if (!hmacKeyPromise) {
    const enc = new TextEncoder();
    hmacKeyPromise = crypto.subtle.importKey(
      "raw",
      enc.encode(getSharedSecretString()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return hmacKeyPromise;
}

async function hmacSha256Hex(message: string): Promise<string> {
  const key = await getHmacKey();
  const enc = new TextEncoder();
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/** Deterministic serialization for signing (sorted object keys at each level). */
export function canonicalPayloadString(payload: unknown): string {
  if (payload === undefined) return "";
  return stableStringify(payload);
}

function stableStringify(val: unknown): string {
  if (val === undefined) return "null";
  if (val === null) return "null";
  const t = typeof val;
  if (t === "number" || t === "boolean") return JSON.stringify(val);
  if (t === "string") return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(",")}]`;
  if (t === "object") {
    const o = val as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(val));
}

export async function signWireRequest(parts: {
  v: number;
  id: string;
  type: string;
  payload: unknown;
  ts: number;
}): Promise<string> {
  const body = `${parts.v}|${parts.id}|${parts.type}|${canonicalPayloadString(parts.payload)}|${parts.ts}`;
  return hmacSha256Hex(body);
}

export async function signWireResponse(parts: {
  v: number;
  id: string;
  success: boolean;
  payload: unknown;
  error: string | undefined;
  ts: number;
}): Promise<string> {
  const err = parts.error ?? "";
  const body = `${parts.v}|${parts.id}|${parts.success}|${canonicalPayloadString(parts.payload)}|${err}|${parts.ts}`;
  return hmacSha256Hex(body);
}

export function assertTimestampFresh(ts: unknown, now = Date.now()): void {
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    throw new Error("protocol: invalid timestamp");
  }
  if (Math.abs(now - ts) > TIMESTAMP_MAX_SKEW_MS) {
    throw new Error("protocol: timestamp outside allowed skew");
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateWirePayload(
  type: WireMessageType,
  payload: unknown,
): void {
  switch (type) {
    case "INIT": {
      if (typeof payload !== "number" || !Number.isInteger(payload)) {
        throw new Error("INIT: size must be integer");
      }
      if (payload < 1 || payload > 10_000_000) {
        throw new Error("INIT: size out of range");
      }
      return;
    }
    case "GET_DATA":
      if (payload !== undefined && payload !== null) {
        throw new Error("GET_DATA: payload must be empty");
      }
      return;
    case "SEARCH": {
      if (!isPlainObject(payload)) throw new Error("SEARCH: object expected");
      if (typeof payload.keyword !== "string") {
        throw new Error("SEARCH: keyword must be string");
      }
      if (typeof payload.requestId !== "string") {
        throw new Error("SEARCH: requestId must be string");
      }
      const f = payload.filters;
      if (f !== undefined && f !== null) {
        if (!isPlainObject(f)) throw new Error("SEARCH: filters must be object");
        if (
          f.minId !== undefined &&
          (typeof f.minId !== "number" || !Number.isFinite(f.minId))
        ) {
          throw new Error("SEARCH: filters.minId");
        }
        if (
          f.maxId !== undefined &&
          (typeof f.maxId !== "number" || !Number.isFinite(f.maxId))
        ) {
          throw new Error("SEARCH: filters.maxId");
        }
      }
      if (payload.page !== undefined) {
        if (
          typeof payload.page !== "number" ||
          !Number.isInteger(payload.page) ||
          payload.page < 0
        ) {
          throw new Error("SEARCH: page must be non-negative integer");
        }
      }
      if (payload.pageSize !== undefined) {
        if (
          typeof payload.pageSize !== "number" ||
          !Number.isInteger(payload.pageSize) ||
          payload.pageSize < 1 ||
          payload.pageSize > 200
        ) {
          throw new Error("SEARCH: pageSize must be integer 1..200");
        }
      }
      return;
    }
    case "BULK_INSERT":
      if (payload === undefined || payload === null) return;
      if (!isPlainObject(payload)) throw new Error("BULK_INSERT: object expected");
      if (
        payload.count !== undefined &&
        (typeof payload.count !== "number" ||
          !Number.isFinite(payload.count) ||
          payload.count < 1)
      ) {
        throw new Error("BULK_INSERT: count");
      }
      return;
  }
}

export async function verifyWireRequest(
  raw: unknown,
): Promise<VaultWireRequest> {
  if (!isPlainObject(raw)) throw new Error("protocol: envelope must be object");
  const v = raw.v;
  const id = raw.id;
  const type = raw.type;
  const ts = raw.ts;
  const sig = raw.sig;
  if (v !== PROTOCOL_VERSION) throw new Error("protocol: unsupported version");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("protocol: invalid id");
  }
  if (typeof type !== "string" || !WIRE_TYPES.has(type)) {
    throw new Error("protocol: invalid type");
  }
  if (typeof sig !== "string" || sig.length === 0) {
    throw new Error("protocol: missing signature");
  }
  assertTimestampFresh(ts);

  const wireType = type as WireMessageType;
  const payload = raw.payload;

  const expected = await signWireRequest({
    v: PROTOCOL_VERSION,
    id,
    type: wireType,
    payload,
    ts: ts as number,
  });
  if (!timingSafeEqualHex(expected, sig)) {
    throw new Error("protocol: invalid request signature");
  }

  validateWirePayload(wireType, payload);

  return {
    v: PROTOCOL_VERSION,
    id,
    type: wireType,
    payload,
    ts: ts as number,
    sig,
  };
}

export async function verifyWireResponse(
  raw: unknown,
): Promise<VaultWireResponse> {
  if (!isPlainObject(raw)) throw new Error("protocol: envelope must be object");
  const v = raw.v;
  const id = raw.id;
  const success = raw.success;
  const ts = raw.ts;
  const sig = raw.sig;
  if (v !== PROTOCOL_VERSION) throw new Error("protocol: unsupported version");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("protocol: invalid id");
  }
  if (typeof success !== "boolean") {
    throw new Error("protocol: invalid success flag");
  }
  if (typeof sig !== "string" || sig.length === 0) {
    throw new Error("protocol: missing signature");
  }
  assertTimestampFresh(ts);

  const payload = raw.payload;
  const error =
    raw.error === undefined || raw.error === null
      ? undefined
      : String(raw.error);

  const expected = await signWireResponse({
    v: PROTOCOL_VERSION,
    id,
    success,
    payload,
    error,
    ts: ts as number,
  });
  if (!timingSafeEqualHex(expected, sig)) {
    throw new Error("protocol: invalid response signature");
  }

  return {
    v: PROTOCOL_VERSION,
    id,
    success,
    payload,
    error,
    ts: ts as number,
    sig,
  };
}
