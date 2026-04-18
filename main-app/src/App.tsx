import { useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "./components/DataTable";
import { PaginationBar } from "./components/PaginationBar";
import { SearchBox } from "./components/SearchBox";
import { Toast } from "./components/Toast";
import { useSearch } from "./hooks/useSearch";
import { messageBus } from "./messaging/messageBus";
import { getVaultOrigin, vaultDisplayHost } from "./vaultOrigin";
import type {
  BulkInsertResponse,
  SearchFilters,
  SearchResponse,
} from "./shared/protocol";

const VAULT_INIT_SIZE = 500_000;
const PAGE_SIZE = 50;

function StatusDot({
  ready,
  loading,
}: {
  ready: boolean;
  loading: boolean;
}) {
  if (!ready) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        Connecting
      </span>
    );
  }
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />
        Loading
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Ready
    </span>
  );
}

export default function App() {
  const [data, setData] = useState<SearchResponse["rows"]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [minIdStr, setMinIdStr] = useState("");
  const [maxIdStr, setMaxIdStr] = useState("");
  const [searchMeta, setSearchMeta] = useState({
    totalMatches: 0,
    page: 0,
    pageSize: PAGE_SIZE,
    capped: false,
  });
  const [toast, setToast] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const [totalVaultRows, setTotalVaultRows] = useState<number | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);

  const vaultListReady = useRef(false);
  const skipFirstQuerySync = useRef(true);
  const skipFirstFilterSync = useRef(true);

  const filters = useMemo((): SearchFilters | undefined => {
    const minRaw = minIdStr.trim();
    const maxRaw = maxIdStr.trim();
    const minId = minRaw === "" ? undefined : Number(minRaw);
    const maxId = maxRaw === "" ? undefined : Number(maxRaw);
    const f: SearchFilters = {};
    if (minId !== undefined && Number.isFinite(minId)) f.minId = minId;
    if (maxId !== undefined && Number.isFinite(maxId)) f.maxId = maxId;
    return Object.keys(f).length ? f : undefined;
  }, [minIdStr, maxIdStr]);

  const filtersRef = useRef(filters);
  const queryTimerRef = useRef(0);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const { search, pending } = useSearch(setData, setSearchMeta);

  const QUERY_DEBOUNCE_MS = 48;

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!vaultListReady.current || loading) return;
    if (skipFirstQuerySync.current) {
      skipFirstQuerySync.current = false;
      return;
    }
    window.clearTimeout(queryTimerRef.current);
    queryTimerRef.current = window.setTimeout(() => {
      void search(query, filtersRef.current, {
        page: 0,
        pageSize: PAGE_SIZE,
      });
    }, QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(queryTimerRef.current);
  }, [query, loading, search]);

  useEffect(() => {
    if (!vaultListReady.current || loading) return;
    if (skipFirstFilterSync.current) {
      skipFirstFilterSync.current = false;
      return;
    }
    window.clearTimeout(queryTimerRef.current);
    void search(query, filters, { page: 0, pageSize: PAGE_SIZE });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-search when filters change; query is read from latest render
  }, [filters, loading, search]);

  const goToPage = (nextPage: number) => {
    const totalPages =
      searchMeta.totalMatches === 0
        ? 1
        : Math.max(1, Math.ceil(searchMeta.totalMatches / searchMeta.pageSize));
    const lastPage = Math.max(0, totalPages - 1);
    const clamped = Math.max(0, Math.min(nextPage, lastPage));
    void search(query, filtersRef.current, {
      page: clamped,
      pageSize: PAGE_SIZE,
    });
  };

  useEffect(() => {
    messageBus.init();

    const iframe = document.getElementById("vault-frame") as HTMLIFrameElement;

    if (!iframe) return;

    iframe.onload = async () => {
      setReady(true);

      try {
        setLoading(true);

        await messageBus.send("INIT", VAULT_INIT_SIZE);

        const res = await messageBus.send<SearchResponse>("SEARCH", {
          keyword: "",
          requestId: crypto.randomUUID(),
          page: 0,
          pageSize: PAGE_SIZE,
        });

        setData(res.rows);
        setSearchMeta({
          totalMatches: res.totalMatches,
          page: res.page,
          pageSize: res.pageSize,
          capped: res.capped,
        });
        setTotalVaultRows(res.totalMatches);
        vaultListReady.current = true;
        skipFirstQuerySync.current = true;
        skipFirstFilterSync.current = true;
      } catch (err) {
        console.error("❌ INIT ERROR:", err);
      } finally {
        setLoading(false);
      }
    };
  }, []);

  const statsLine = !ready
    ? "…"
    : loading
      ? "…"
      : [
          `${searchMeta.totalMatches.toLocaleString()} khớp · ${data.length.toLocaleString()} trên trang`,
          totalVaultRows != null
            ? ` · vault ${totalVaultRows.toLocaleString()} dòng`
            : "",
        ].join("");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-br from-slate-100 via-violet-50/40 to-slate-100">
      {/* Single viewport frame: no page scroll; only the table body scrolls */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-3 py-3 sm:px-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/95 shadow-card-lg backdrop-blur-sm">
          {/* Top bar — fixed height */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h1 className="truncate text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                Data Vault
              </h1>
              <StatusDot ready={ready} loading={loading} />
              {(pending || bulkWorking) && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100/90 px-2.5 py-0.5 text-[11px] font-medium text-violet-800">
                  <svg
                    className="h-3 w-3 animate-spin text-violet-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {bulkWorking ? "Bulk…" : "Sync…"}
                </span>
              )}
            </div>
            <p className="max-w-[55%] truncate text-right text-[11px] text-slate-500 sm:text-xs">
              {statsLine}
            </p>
          </div>

          {/* Toolbar — one row, equal control height (h-10) */}
          <div className="shrink-0 border-b border-slate-50 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="min-w-[12rem] flex-1 basis-0">
                <SearchBox
                  compact
                  value={query}
                  onChange={setQuery}
                  placeholder="Search users…"
                />
              </div>
              <input
                type="number"
                inputMode="numeric"
                aria-label="Minimum ID"
                placeholder="Min ID"
                className="h-10 w-[7rem] shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 tabular-nums shadow-sm outline-none ring-violet-500/15 placeholder:text-slate-400 focus:border-violet-300 focus:ring-2"
                value={minIdStr}
                onChange={(e) => setMinIdStr(e.target.value)}
              />
              <input
                type="number"
                inputMode="numeric"
                aria-label="Maximum ID"
                placeholder="Max ID"
                className="h-10 w-[7rem] shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 tabular-nums shadow-sm outline-none ring-violet-500/15 placeholder:text-slate-400 focus:border-violet-300 focus:ring-2"
                value={maxIdStr}
                onChange={(e) => setMaxIdStr(e.target.value)}
              />
              <button
                type="button"
                disabled={!ready || loading || bulkWorking || pending}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-sm outline-none transition hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:pointer-events-none disabled:opacity-40"
                title="Bulk insert 50,000 rows in worker"
                  onClick={() => {
                    void (async () => {
                      setBulkWorking(true);
                      try {
                        const out = await messageBus.send<BulkInsertResponse>(
                          "BULK_INSERT",
                          { count: 50_000 },
                          { timeout: 120_000 },
                        );
                        setTotalVaultRows(out.totalRows);
                        setToast({
                          variant: "success",
                          message: `Đã thêm ${out.inserted.toLocaleString()} dòng. Vault hiện có ${out.totalRows.toLocaleString()} dòng.`,
                        });
                      } catch (e) {
                        console.error("Bulk insert failed:", e);
                        setToast({
                          variant: "error",
                          message: "Thêm bulk thất bại — xem console.",
                        });
                      } finally {
                        setBulkWorking(false);
                      }
                      void search(query, filtersRef.current, {
                        page: 0,
                        pageSize: PAGE_SIZE,
                      });
                    })();
                  }}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  +50k
                </button>
            </div>
          </div>

          {/* Table — fills remaining height; internal scroll only */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-4 pt-3 sm:px-5">
            {!ready || loading ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                {[...Array(12)].map((_, i) => (
                  <div
                    key={i}
                    className="h-9 shrink-0 animate-pulse rounded-lg bg-gradient-to-r from-slate-200/70 via-slate-100 to-slate-200/70"
                  />
                ))}
              </div>
            ) : (
              <>
                <DataTable
                  data={data}
                  pending={pending || bulkWorking}
                  className="min-h-0 flex-1"
                />
                <PaginationBar
                  page={searchMeta.page}
                  pageSize={searchMeta.pageSize}
                  totalMatches={searchMeta.totalMatches}
                  onPageChange={goToPage}
                  disabled={pending || bulkWorking}
                />
              </>
            )}
          </div>

          <p className="shrink-0 border-t border-slate-100 px-4 py-2 text-center text-[10px] text-slate-400 sm:px-5">
            Vault @{vaultDisplayHost()} · main app
          </p>
        </div>

        <iframe
          id="vault-frame"
          src={getVaultOrigin()}
          className="hidden"
          title="Data vault"
        />

        {toast ? (
          <Toast
            message={toast.message}
            variant={toast.variant}
            onDismiss={() => setToast(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
