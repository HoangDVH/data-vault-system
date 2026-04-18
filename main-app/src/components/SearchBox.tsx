type SearchBoxProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Tighter padding for single-screen layouts */
  compact?: boolean;
};

export const SearchBox = ({
  value,
  onChange,
  placeholder = "Search by name…",
  compact = false,
}: SearchBoxProps) => {
  const hasValue = value.length > 0;
  const pad = compact
    ? `h-10 py-0 pl-9 ${hasValue ? "pr-9" : "pr-3"} text-sm leading-none`
    : `py-3.5 pl-12 ${hasValue ? "pr-11" : "pr-4"} text-[15px]`;
  const iconLeft = compact ? "pl-2.5" : "pl-4";

  return (
    <label className="relative block min-w-0">
      <span
        className={`pointer-events-none absolute inset-y-0 left-0 flex items-center text-slate-400 ${iconLeft}`}
      >
        <svg
          className={compact ? "h-4 w-4" : "h-5 w-5"}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </span>
      <input
        className={`w-full rounded-xl border border-slate-200/90 bg-white ${pad} text-slate-900 shadow-sm outline-none ring-violet-500/20 transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      {hasValue ? (
        <button
          type="button"
          className={`absolute inset-y-0 right-0 flex items-center justify-center rounded-lg text-slate-400 outline-none ring-violet-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 ${compact ? "w-9" : "w-11"}`}
          aria-label="Xóa tìm kiếm"
          onClick={() => onChange("")}
        >
          <svg
            className={compact ? "h-4 w-4" : "h-5 w-5"}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      ) : null}
    </label>
  );
};
