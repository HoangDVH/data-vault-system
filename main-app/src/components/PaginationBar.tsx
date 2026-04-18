type PaginationBarProps = {
  page: number;
  pageSize: number;
  totalMatches: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
};

export function PaginationBar({
  page,
  pageSize,
  totalMatches,
  onPageChange,
  disabled = false,
}: PaginationBarProps) {
  const totalPages =
    totalMatches === 0 ? 1 : Math.max(1, Math.ceil(totalMatches / pageSize));
  const lastPage = Math.max(0, totalPages - 1);
  const prevDisabled = disabled || page <= 0 || totalMatches === 0;
  const nextDisabled = disabled || page >= lastPage || totalMatches === 0;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
      <p className="text-[12px] tabular-nums text-slate-600">
        <span className="font-semibold text-slate-800">
          {totalMatches.toLocaleString()}
        </span>{" "}
        kết quả · Trang{" "}
        <span className="font-semibold text-slate-800">
          {Math.min(page + 1, totalPages)}
        </span>{" "}
        / {totalPages}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={prevDisabled}
          aria-label="Trang trước"
          className="inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm outline-none transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-violet-400"
          onClick={() => onPageChange(page - 1)}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          type="button"
          disabled={nextDisabled}
          aria-label="Trang sau"
          className="inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm outline-none transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-violet-400"
          onClick={() => onPageChange(page + 1)}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
