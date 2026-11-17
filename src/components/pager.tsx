"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const STORAGE_PREFIX = "pmv-page-size:";

/**
 * Splits a long list into pages. The chosen page size is kept in this browser per list (`storageKey`), so a person who
 * prefers 50 rows keeps getting 50. When the list shrinks (a filter, an approval) the page is pulled back into range.
 */
export function usePagination<T>(items: T[], options: { storageKey?: string; initialPageSize?: number } = {}) {
  const { storageKey, initialPageSize = 25 } = options;
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = Number(window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`));
      if (PAGE_SIZE_OPTIONS.includes(stored)) setPageSizeState(stored);
    } catch {
      // Storage blocked: keep the default size.
    }
  }, [storageKey]);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);

  const pageItems = useMemo(() => items.slice((current - 1) * pageSize, current * pageSize), [items, current, pageSize]);

  function setPageSize(size: number) {
    setPageSizeState(size);
    setPage(1);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, String(size));
    } catch {
      // Not saved; the size still applies until the page is closed.
    }
  }

  return {
    page: current,
    pageCount,
    pageSize,
    pageItems,
    total: items.length,
    setPage: (next: number) => setPage(Math.min(Math.max(1, next), pageCount)),
    setPageSize,
  };
}

/** Which page numbers to show: always the first and last, the current one and its neighbours, with gaps as "…". */
function pageWindow(page: number, pageCount: number): Array<number | "gap"> {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pageCount));
  const sorted = [...wanted].sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  for (const [index, value] of sorted.entries()) {
    if (index > 0 && value - sorted[index - 1] > 1) result.push("gap");
    result.push(value);
  }
  return result;
}

export function Pager({
  page,
  pageCount,
  pageSize,
  total,
  setPage,
  setPageSize,
  noun = "rows",
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  noun?: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const button = "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm">
      <div className="flex items-center gap-3 text-slate-600">
        <span>
          Showing <span className="font-medium text-slate-900">{from}–{to}</span> of <span className="font-medium text-slate-900">{total}</span> {noun}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          Per page
          <select
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-cyan-300"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
      </div>
      {pageCount > 1 ? (
        <nav className="flex items-center gap-1" aria-label="Pages">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className={`${button} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageWindow(page, pageCount).map((item, index) =>
            item === "gap" ? (
              <span key={`gap-${index}`} className="px-1 text-xs text-slate-400">…</span>
            ) : (
              <button
                key={item}
                type="button"
                aria-current={item === page ? "page" : undefined}
                onClick={() => setPage(item)}
                className={`${button} ${item === page ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {item}
              </button>
            ),
          )}
          <button type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage(page + 1)} className={`${button} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}

/** A list with the standard pager under it, for places where the hook cannot sit at the top of the component. */
export function PagedList<T>({
  items,
  storageKey,
  noun,
  initialPageSize = 25,
  children,
}: {
  items: T[];
  storageKey: string;
  noun?: string;
  initialPageSize?: number;
  children: (pageItems: T[]) => ReactNode;
}) {
  const pagination = usePagination(items, { storageKey, initialPageSize });
  return (
    <>
      {children(pagination.pageItems)}
      <Pager {...pagination} noun={noun} />
    </>
  );
}
