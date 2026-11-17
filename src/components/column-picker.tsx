"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Columns3 } from "lucide-react";

export type ColumnDef = { key: string; label: string };

const PREFIX = "pmv-table-columns:";

/**
 * Lets each person choose which columns of a table to show. The choice is kept in this browser (localStorage), per table,
 * so it is still there next time. Columns start visible; only the ones the person hides are stored, so a column added
 * later shows up by itself. Storage can be blocked, in which case the table simply shows every column.
 */
export function useColumnPreferences(tableKey: string, columns: ColumnDef[]) {
  const storageKey = `${PREFIX}${tableKey}`;
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) setHidden(parsed.filter((value): value is string => typeof value === "string"));
    } catch {
      // Stored value unreadable or storage blocked: show every column.
    }
  }, [storageKey]);

  const save = useCallback(
    (next: string[]) => {
      setHidden(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Not saved (private window or blocked storage); the choice still applies until the page is closed.
      }
    },
    [storageKey],
  );

  const isShown = useCallback((key: string) => !hidden.includes(key), [hidden]);
  const shownCount = columns.filter((column) => !hidden.includes(column.key)).length;

  const picker: ReactNode = (
    <ColumnPicker
      columns={columns}
      hidden={hidden}
      onToggle={(key) => save(hidden.includes(key) ? hidden.filter((value) => value !== key) : [...hidden, key])}
      onReset={() => save([])}
    />
  );

  return { isShown, picker, shownCount };
}

function ColumnPicker({ columns, hidden, onToggle, onReset }: { columns: ColumnDef[]; hidden: string[]; onToggle: (key: string) => void; onReset: () => void }) {
  return (
    <details className="relative inline-block text-left">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <Columns3 className="h-4 w-4" />
        Columns{hidden.length > 0 ? ` (${columns.length - hidden.length}/${columns.length})` : ""}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {columns.map((column) => (
            <label key={column.key} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
              <input type="checkbox" checked={!hidden.includes(column.key)} onChange={() => onToggle(column.key)} className="h-4 w-4 rounded border-slate-300" />
              {column.label}
            </label>
          ))}
        </div>
        <button type="button" onClick={onReset} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Show all columns
        </button>
      </div>
    </details>
  );
}
