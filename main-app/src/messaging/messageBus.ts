import {
  PROTOCOL_VERSION,
  signWireRequest,
  vaultProtocolDebug,
  verifyWireResponse,
} from "../../../shared/vaultProtocol.ts";
import { getVaultOrigin } from "../vaultOrigin";

type Callback = {
  resolve: (data: unknown) => void;
  reject: (err: unknown) => void;
  timestamp: number;
};

class MessageBus {
  private callbacks = new Map<string, Callback>();
  private iframe: HTMLIFrameElement | null = null;

  private vaultOrigin(): string {
    return getVaultOrigin();
  }

  init() {
    this.iframe = document.getElementById("vault-frame") as HTMLIFrameElement;

    window.addEventListener("message", this.handleMessage);
  }

  private handleMessage = (event: MessageEvent) => {
    void this.dispatchVerified(event);
  };

  private async dispatchVerified(event: MessageEvent) {
    const allowed = this.vaultOrigin();
    if (event.origin !== allowed) {
      vaultProtocolDebug("main-app", "ignored postMessage (wrong origin)", {
        allowed,
        received: event.origin,
      });
      return;
    }

    try {
      const envelope = await verifyWireResponse(event.data);

      const cb = this.callbacks.get(envelope.id);
      if (!cb) {
        vaultProtocolDebug(
          "main-app",
          "verified envelope but no pending RPC for id (orphan reply?)",
          envelope.id,
        );
        return;
      }

      this.callbacks.delete(envelope.id);

      if (envelope.success) {
        cb.resolve(envelope.payload);
      } else {
        cb.reject(envelope.error ?? "Vault error");
      }
    } catch (e) {
      vaultProtocolDebug(
        "main-app",
        "rejected iframe response (signature / version / timestamp / shape)",
        e,
      );
    }
  }

  send<T = unknown>(
    type: string,
    payload?: unknown,
    options = { timeout: 5000 },
  ): Promise<T> {
    const id = crypto.randomUUID();
    const ts = Date.now();

    return (async () => {
      const sig = await signWireRequest({
        v: PROTOCOL_VERSION,
        id,
        type,
        payload,
        ts,
      });

      return await new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.callbacks.delete(id);
          reject(new Error("Timeout"));
        }, options.timeout);

        this.callbacks.set(id, {
          resolve: (data) => {
            clearTimeout(timeout);
            resolve(data as T);
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
          timestamp: Date.now(),
        });

        this.iframe?.contentWindow?.postMessage(
          {
            v: PROTOCOL_VERSION,
            id,
            type,
            payload,
            ts,
            sig,
          },
          this.vaultOrigin(),
        );
      });
    })();
  }
}

export const messageBus = new MessageBus();

