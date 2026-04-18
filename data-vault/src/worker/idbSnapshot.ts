/** Persist `rows[]` to IndexedDB inside the dedicated worker (survives iframe reload). */

export type PersistedRow = { id: number; name: string; nameLc: string };

const DB_NAME = "data-vault-worker-snapshot";
const STORE = "kv";
const KEY = "rows";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

export async function loadRowsSnapshot(): Promise<PersistedRow[] | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const v = req.result;
      if (!v) {
        resolve(null);
        return;
      }
      if (!Array.isArray(v)) {
        resolve(null);
        return;
      }
      resolve(v as PersistedRow[]);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveRowsSnapshot(rows: PersistedRow[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB write failed"));
    tx.objectStore(STORE).put(rows, KEY);
  });
}
