"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type PickableUser = { id: string; name: string; email?: string | null; userType?: { name: string } | null };

/**
 * Pick one user from a long list: type to search by name, email or user type. Empty value = nobody.
 */
export default function UserPicker({
  value,
  users,
  onChange,
  placeholder = "Choose a user",
  emptyLabel = "Nobody",
  ariaLabel,
}: {
  value: string;
  users: PickableUser[];
  onChange: (userId: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = users.find((user) => user.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return users;
    return users.filter((user) => {
      const text = `${user.name} ${user.email ?? ""} ${user.userType?.name ?? ""}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [query, users]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-[38px] w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm outline-none transition focus:ring-2 focus:ring-cyan-300 ${
          open ? "border-cyan-400" : "border-slate-300 hover:border-slate-400"
        }`}
      >
        <span className={`min-w-0 truncate ${selected ? "text-slate-900" : "text-slate-400"}`}>
          {selected ? `${selected.name}${selected.userType ? ` (${selected.userType.name})` : ""}` : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {selected ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear"
              onClick={(event) => {
                event.stopPropagation();
                choose("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  choose("");
                }
              }}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
          <div className="flex h-10 items-center gap-2 border-b border-slate-100 px-3">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email or type..."
              aria-label="Search users"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1.5" role="listbox">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => choose("")}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${!value ? "bg-cyan-50 text-cyan-950" : "text-slate-500 hover:bg-slate-50"}`}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{!value ? <Check className="h-3.5 w-3.5" /> : null}</span>
              {emptyLabel}
            </button>
            {matches.length === 0 ? <p className="px-3 py-3 text-sm text-slate-500">No matching users.</p> : null}
            {matches.map((user) => {
              const checked = user.id === value;
              return (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => choose(user.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${checked ? "bg-cyan-50 text-cyan-950" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">{checked ? <Check className="h-3.5 w-3.5" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{user.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[user.userType?.name, user.email].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
