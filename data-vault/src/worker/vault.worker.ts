export type UserWire = { id: number; name: string };

type Row = UserWire & { nameLc: string };

/** GET_DATA preview cap */
const RESULT_CAP = 1000;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

let rows: Row[] = [];

function generateData(size: number): Row[] {
  const out: Row[] = new Array(size);
  for (let i = 0; i < size; i++) {
    const name = "User " + i;
    out[i] = { id: i, name, nameLc: name.toLowerCase() };
  }
  return out;
}

/**
 * Rows per synchronous slice before yielding. Larger = faster insert; smaller =
 * more chances for SEARCH/other RPC between slices.
 */
const BULK_SLICE = 16_000;

async function runBulkInsertAsync(
  clientId: string,
  payload: { count?: number },
): Promise<void> {
  const requested = payload?.count ?? 50000;
  const count = Math.min(Math.max(1, requested), 1_000_000);

  try {
    const start = rows.length;
    rows.length = start + count;

    for (let offset = 0; offset < count; offset += BULK_SLICE) {
      const end = Math.min(offset + BULK_SLICE, count);
      for (let i = offset; i < end; i++) {
        const id = start + i;
        const name = "User " + id;
        rows[start + i] = { id, name, nameLc: name.toLowerCase() };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    self.postMessage({
      id: clientId,
      data: { inserted: count, totalRows: rows.length },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ id: clientId, error: message });
  }
}

function rowMatches(
  r: Row,
  keywordLc: string,
  minId: number,
  maxId: number,
): boolean {
  if (r.id < minId || r.id > maxId) return false;
  if (keywordLc.length === 0) return true;
  return r.nameLc.includes(keywordLc);
}

function searchPaginated(
  keywordLc: string,
  minIdIn: number,
  maxIdIn: number,
  pageIn: number,
  pageSizeIn: number,
): {
  rows: UserWire[];
  totalMatches: number;
  page: number;
  pageSize: number;
  capped: boolean;
} {
  let minId = minIdIn;
  let maxId = maxIdIn;
  if (minId > maxId) {
    const t = minId;
    minId = maxId;
    maxId = t;
  }

  let pageSize = Math.floor(pageSizeIn);
  if (!Number.isFinite(pageSize)) pageSize = DEFAULT_PAGE_SIZE;
  pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));

  let page = Math.floor(pageIn);
  if (!Number.isFinite(page) || page < 0) page = 0;

  const start = page * pageSize;
  const end = start + pageSize;
  const out: UserWire[] = [];
  let ord = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!rowMatches(r, keywordLc, minId, maxId)) continue;
    if (ord >= start && ord < end) {
      out.push({ id: r.id, name: r.name });
    }
    ord++;
  }

  return {
    rows: out,
    totalMatches: ord,
    page,
    pageSize,
    capped: false,
  };
}

self.onmessage = (e: MessageEvent<{ id: string; type: string; payload: unknown }>) => {
  const { id, type, payload } = e.data;

  if (type === "BULK_INSERT") {
    void runBulkInsertAsync(id, payload as { count?: number });
    return;
  }

  try {
    let result: unknown;

    switch (type) {
      case "INIT":
        rows = generateData(payload as number);
        result = true;
        break;

      case "GET_DATA": {
        const n = Math.min(RESULT_CAP, rows.length);
        const slice: UserWire[] = [];
        for (let i = 0; i < n; i++) {
          const r = rows[i]!;
          slice.push({ id: r.id, name: r.name });
        }
        result = slice;
        break;
      }

      case "SEARCH": {
        const p = payload as {
          keyword: string;
          filters?: { minId?: number; maxId?: number };
          page?: number;
          pageSize?: number;
        };
        const keywordLc = (p.keyword ?? "").trim().toLowerCase();
        const f = p.filters;
        const minId =
          f?.minId !== undefined && Number.isFinite(f.minId)
            ? (f.minId as number)
            : -Infinity;
        const maxId =
          f?.maxId !== undefined && Number.isFinite(f.maxId)
            ? (f.maxId as number)
            : Infinity;
        result = searchPaginated(
          keywordLc,
          minId,
          maxId,
          p.page ?? 0,
          p.pageSize ?? DEFAULT_PAGE_SIZE,
        );
        break;
      }

      default:
        throw new Error("Unknown worker message type");
    }

    self.postMessage({ id, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, error: message });
  }
};
