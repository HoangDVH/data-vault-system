const w = new Worker(new URL("./vault.worker.ts", import.meta.url), {
  type: "module",
});

export type SearchPayload = {
  keyword: string;
  requestId: string;
  filters?: { minId?: number; maxId?: number };
  page?: number;
  pageSize?: number;
};

type Pending = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
};

const callbacks = new Map<string, Pending>();

w.onmessage = (e: MessageEvent<{ id: string; data?: unknown; error?: string }>) => {
  const { id, data, error } = e.data;
  const pending = callbacks.get(id);
  if (!pending) return;
  callbacks.delete(id);
  if (error !== undefined) {
    pending.reject(new Error(error));
  } else {
    pending.resolve(data);
  }
};

const call = (type: string, payload?: unknown) => {
  const id = crypto.randomUUID();
  w.postMessage({ id, type, payload });

  return new Promise((resolve, reject) => {
    callbacks.set(id, { resolve, reject });
  });
};

export const worker = {
  init: (size: number) => call("INIT", size),
  getData: () => call("GET_DATA"),
  search: (payload: SearchPayload) => call("SEARCH", payload),
  bulkInsert: (payload?: { count?: number }) => call("BULK_INSERT", payload ?? {}),
};
