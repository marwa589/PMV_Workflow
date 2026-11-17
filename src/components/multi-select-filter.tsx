"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type MultiSelectOption = { value: string; label: string };

/**
 * A drop-down where several options can be ticked. It lives inside a normal GET form: every ticked option is a real
 * checkbox with the same name, so the address carries ?name=a&name=b and nothing else is needed to submit it.
 */
export default function MultiSelectFilter({
  id,
  name,
  options,
  defaultValues = [],
  allLabel = "All",
}: {
  id: string;
  name: string;
  options: MultiSelectOption[];
  defaultValues?: string[];
  allLabel?: string;
}) {
  const [selected, setSelected] = useState<string[]>(defaultValues);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Selected values that are no longer offered (e.g. a sub type of a type that was unticked) are dropped.
  const offered = new Set(options.map((option) => option.value));
  const chosen = selected.filter((value) => offered.has(value));

  const summary =
    chosen.length === 0
      ? allLabel
      : chosen.length === 1
        ? options.find((option) => option.value === chosen[0])?.label ?? allLabel
        : `${chosen.length} selected`;
  const visible = query.trim() ? options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase())) : options;

  function toggle(value: string) {
    setSelected((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
      </button>

      {/* The checkboxes stay in the page while closed, so the form always submits the current choice. */}
      <div className={`${open ? "block" : "hidden"} absolute left-0 right-0 z-20 mt-1 min-w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg`}>
        {options.length > 8 ? (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-400"
          />
        ) : null}
        <ul className="max-h-56 overflow-y-auto" role="listbox" aria-multiselectable="true">
          {options.map((option) => (
            <li key={option.value} className={visible.includes(option) ? "" : "hidden"}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  name={name}
                  value={option.value}
                  checked={chosen.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span className="truncate">{option.label}</span>
              </label>
            </li>
          ))}
          {options.length === 0 ? <li className="px-2 py-1.5 text-sm text-slate-500">No options</li> : null}
        </ul>
        {chosen.length > 0 ? (
          <button type="button" onClick={() => setSelected([])} className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-cyan-700 hover:bg-slate-50">
            Clear selection
          </button>
        ) : null}
      </div>
    </div>
  );
}
