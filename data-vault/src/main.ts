import {
  isPlainObject,
  PROTOCOL_VERSION,
  signWireResponse,
  vaultProtocolDebug,
  verifyWireRequest,
} from "../../shared/vaultProtocol.ts";
import { worker, type SearchPayload } from "./worker/workerProxy";

/**
 * Parent origins allowed to postMessage into this iframe.
 * Local dev defaults + optional VITE_ALLOWED_PARENT_ORIGINS (comma-separated, e.g. https://main-app.vercel.app).
 */
function buildAllowedParentOrigins(): Set<string> {
  const set = new Set([
    "http://localhost:5174",
    "http://127.0.0.1:5174",
  ]);
  const raw = import.meta.env.VITE_ALLOWED_PARENT_ORIGINS as string | undefined;
  if (raw) {
    for (const part of raw.split(",")) {
      const o = part.trim().replace(/\/+$/, "");
      if (o) set.add(o);
    }
  }
  return set;
}

const ALLOWED_PARENT_ORIGINS = buildAllowedParentOrigins();

window.addEventListener("message", async (event) => {
  if (!ALLOWED_PARENT_ORIGINS.has(event.origin)) {
    vaultProtocolDebug("data-vault", "ignored postMessage (wrong origin)", {
      allowed: [...ALLOWED_PARENT_ORIGINS],
      received: event.origin,
    });
    return;
  }

  const raw = event.data;
  let correlationId = "";
  if (isPlainObject(raw) && typeof raw.id === "string") {
    correlationId = raw.id;
  }

  try {
    const req = await verifyWireRequest(raw);

    let result: unknown;

    switch (req.type) {
      case "INIT":
        result = await worker.init(req.payload as number);
        break;

      case "GET_DATA":
        result = await worker.getData();
        break;

      case "SEARCH":
        result = await worker.search(req.payload as SearchPayload);
        break;

      case "BULK_INSERT":
        result = await worker.bulkInsert(
          req.payload as { count?: number } | undefined,
        );
        break;
    }

    const ts = Date.now();
    const sig = await signWireResponse({
      v: PROTOCOL_VERSION,
      id: req.id,
      success: true,
      payload: result,
      error: undefined,
      ts,
    });

    (event.source as Window).postMessage(
      {
        v: PROTOCOL_VERSION,
        id: req.id,
        success: true,
        payload: result,
        ts,
        sig,
      },
      event.origin,
    );
  } catch (err: unknown) {
    vaultProtocolDebug(
      "data-vault",
      correlationId
        ? "request failed or protocol reject — sending signed error reply"
        : "request rejected (no id to reply) — likely bad envelope / sig",
      err,
    );
    if (!correlationId) return;

    const message = err instanceof Error ? err.message : String(err);
    const ts = Date.now();
    const sig = await signWireResponse({
      v: PROTOCOL_VERSION,
      id: correlationId,
      success: false,
      payload: undefined,
      error: message,
      ts,
    });

    (event.source as Window).postMessage(
      {
        v: PROTOCOL_VERSION,
        id: correlationId,
        success: false,
        error: message,
        ts,
        sig,
      },
      event.origin,
    );
  }
});
