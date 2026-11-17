"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Search, Sparkles, X } from "lucide-react";
import { rankEntries, squash } from "@/lib/linked-document-match";

export type LinkedDocumentEntry = {
  key: string;
  mode: "continue" | "addition";
  runId: string;
  label: string;
  projectLabel: string | null;
  previousDocument: { id: string; documentNumber: string; title: string; approvedAtLabel: string | null } | null;
  option: { name: string; waitingUntil?: Date | string | null };
};

const MAX_VISIBLE = 50;

function entryText(entry: LinkedDocumentEntry): string {
  return [entry.previousDocument?.documentNumber, entry.previousDocument?.title, entry.label, entry.projectLabel, entry.option.name].filter(Boolean).join(" ");
}

function EntryLines({ entry }: { entry: LinkedDocumentEntry }) {
  return (
    <>
      <span className="block truncate text-sm">
        {entry.previousDocument ? (
          <>
            <span className="font-medium text-slate-900">{entry.previousDocument.documentNumber}</span>
            <span className="text-slate-600"> · {entry.previousDocument.title}</span>
          </>
        ) : (
          <span className="font-medium text-slate-900">{entry.label}</span>
        )}
      </span>
      <span className="block truncate text-xs text-slate-500">
        {entry.label}
        {entry.projectLabel ? ` · ${entry.projectLabel}` : ""}
        {` · next: ${entry.option.name}`}
        {entry.mode === "addition" ? " · completed, added to the same group" : ""}
      </span>
    </>
  );
}

/**
 * Searchable "linked document" choice for ONE uploaded file.
 *  - Type to search by document number, title, process, project or step ("mr214497" finds "MR 214497").
 *  - Documents whose name appears in the file's name are offered first, under "Matches the file name".
 *  - `auto` shows that the choice was made by name matching; the uploader can still pick anything else.
 */
export default function LinkedDocumentPicker({
  id,
  entries,
  value,
  auto,
  required,
  matchText,
  disabled = false,
  onChange,
}: {
  id: string;
  entries: LinkedDocumentEntry[];
  value: string;
  auto: boolean;
  required: boolean;
  /** Texts of the file (its name, its title) used to rank the suggestions. */
  matchText: string[];
  disabled?: boolean;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = entries.find((entry) => entry.key === value) ?? null;

  // Entries whose document is mentioned in the file name, best first.
  const suggestedKeys = useMemo(() => {
    const seen = new Map<string, number>();
    for (const text of matchText) {
      for (const { entry, score } of rankEntries(text, entries)) seen.set(entry.key, Math.max(seen.get(entry.key) ?? 0, score));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  }, [matchText, entries]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const squashed = squash(term);
    let list = entries;
    if (term) {
      list = entries.filter((entry) => {
        const text = entryText(entry);
        return text.toLowerCase().includes(term) || (squashed.length > 0 && squash(text).includes(squashed));
      });
    }
    // Suggestions on top (when nothing is typed they get their own heading).
    const rank = new Map(suggestedKeys.map((key, index) => [key, index]));
    return [...list].sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9));
  }, [entries, search, suggestedKeys]);

  const visible = rows.slice(0, MAX_VISIBLE);
  // Index 0 is the "no linked document" row when the link is optional.
  const offset = required ? 0 : 1;
  const totalRows = visible.length + offset;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [search, open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(key: string) {
    onChange(key);
    setOpen(false);
    setSearch("");
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, totalRows - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!required && active === 0) return choose("");
      const entry = visible[active - offset];
      if (entry) choose(entry.key);
    }
  }

  const showSuggestionHeading = !search.trim() && suggestedKeys.length > 0;
  const firstOtherIndex = visible.findIndex((entry) => !suggestedKeys.includes(entry.key));

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left outline-none ring-cyan-300 transition focus:ring-2 disabled:opacity-60 ${
            required && !selected ? "border-amber-400" : "border-slate-300"
          }`}
        >
          <span className="min-w-0 flex-1">
            {selected ? (
              <EntryLines entry={selected} />
            ) : (
              <span className="block text-sm text-slate-500">{required ? "Choose the document this one follows" : "No linked document"}</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
        {selected && !required ? (
          <button
            type="button"
            title="Remove the link"
            aria-label="Remove the link"
            disabled={disabled}
            onClick={() => choose("")}
            className="rounded-lg border border-slate-300 bg-white px-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {selected && auto ? (
        <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
          <Sparkles className="h-3.5 w-3.5" />
          Linked automatically: the file name contains this document&apos;s name. Change it below if it is wrong.
        </p>
      ) : null}

      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg" onKeyDown={onKeyDown}>
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by number, title, process or project"
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <ul ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {!required ? (
              <li>
                <button
                  type="button"
                  data-row={0}
                  role="option"
                  aria-selected={!value}
                  onMouseEnter={() => setActive(0)}
                  onClick={() => choose("")}
                  className={`block w-full px-3 py-2 text-left text-sm text-slate-600 ${active === 0 ? "bg-slate-100" : ""}`}
                >
                  No linked document
                </button>
              </li>
            ) : null}
            {visible.length === 0 ? <li className="px-3 py-3 text-sm text-slate-500">No linkable document found{search.trim() ? " for this search" : ""}.</li> : null}
            {visible.map((entry, index) => (
              <li key={entry.key}>
                {showSuggestionHeading && index === 0 ? <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Matches the file name</p> : null}
                {showSuggestionHeading && index === firstOtherIndex && firstOtherIndex > 0 ? (
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">All documents</p>
                ) : null}
                <button
                  type="button"
                  data-row={index + offset}
                  role="option"
                  aria-selected={entry.key === value}
                  onMouseEnter={() => setActive(index + offset)}
                  onClick={() => choose(entry.key)}
                  className={`block w-full px-3 py-2 text-left ${active === index + offset ? "bg-slate-100" : ""} ${entry.key === value ? "border-l-2 border-cyan-500" : ""}`}
                >
                  <EntryLines entry={entry} />
                </button>
              </li>
            ))}
            {rows.length > MAX_VISIBLE ? (
              <li className="px-3 py-2 text-xs text-slate-500">Showing the first {MAX_VISIBLE} of {rows.length}. Type more of the number or title to narrow the list.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
