type ToastProps = {
  message: string;
  variant?: "success" | "error";
  onDismiss: () => void;
};

export function Toast({
  message,
  variant = "success",
  onDismiss,
}: ToastProps) {
  const styles =
    variant === "success"
      ? "border-emerald-200/90 bg-emerald-50/95 text-emerald-950"
      : "border-rose-200/90 bg-rose-50/95 text-rose-950";

  return (
    <div
      role="status"
      className={`fixed right-6 top-6 z-[100] flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-card-lg backdrop-blur-sm ${styles}`}
    >
      <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
        {message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-lg p-1 text-current opacity-60 outline-none ring-violet-400 transition hover:opacity-100 focus-visible:ring-2"
        aria-label="Đóng"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
