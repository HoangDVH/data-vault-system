import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { User } from "../shared/protocol";

type DataTableProps = {
  data: User[];
  /** True while waiting for vault — keeps typing instant, table slightly muted */
  pending?: boolean;
  /** Parent should be a flex child with flex-1 min-h-0 so the list fills the frame */
  className?: string;
};

export const DataTable = ({ data, pending, className = "" }: DataTableProps) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const showEmpty = data.length === 0 && !pending;

  // eslint-disable-next-line react-hooks/incompatible-library -- useVirtualizer is the supported API
  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 6,
  });

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-card transition-opacity duration-200 ${pending ? "pointer-events-none opacity-55" : "opacity-100"} ${className}`}
    >
      <div className="grid shrink-0 grid-cols-[5rem_minmax(0,1fr)] gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          ID
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Name
        </span>
      </div>

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        {showEmpty ? (
          <div className="flex min-h-[min(40vh,16rem)] flex-col items-center justify-center gap-2 px-6 py-14 text-center">
            <p className="text-[15px] font-semibold text-slate-700">
              Không có dữ liệu
            </p>
            <p className="max-w-sm text-sm text-slate-500">
              Không có dòng nào khớp tìm kiếm hoặc bộ lọc. Thử xóa bớt điều kiện
              hoặc đổi trang.
            </p>
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = data[virtualRow.index];
              const isEven = virtualRow.index % 2 === 0;

              return (
                <div
                  key={virtualRow.key}
                  className={`absolute flex w-full items-center gap-3 px-4 transition-colors ${
                    isEven ? "bg-white" : "bg-slate-50/60"
                  } hover:bg-violet-50/80`}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <span className="w-20 shrink-0 font-mono text-sm tabular-nums text-violet-600/90">
                    #{item?.id}
                  </span>
                  <span className="min-w-0 truncate text-[14px] font-medium text-slate-800">
                    {item?.name}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
