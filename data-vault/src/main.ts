import {
  isPlainObject,
  PROTOCOL_VERSION,
  signWireResponse,
  vaultProtocolDebug,
  verifyWireRequest,
} from "../../shared/vaultProtocol.ts";
import { worker, type SearchPayload } from "./worker/workerProxy";

/**
 * Origin of the parent app that embeds this iframe (postMessage sender).
 * Must match where main-app runs (e.g. Vite default for main-app is 5174).
 */
const ALLOWED_PARENT_ORIGINS = new Set([
  "http://localhost:5174",
  "http://127.0.0.1:5174",
]);

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
