"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type PickableProject = {
  id: string;
  code: string;
  name: string;
  director?: { name: string; isActive: boolean } | null;
  manager?: { name: string; isActive: boolean } | null;
};

/** "Ali" for an active person, null otherwise (an inactive account is not shown as the project's person). */
function activeName(person: PickableProject["director"]): string | null {
  return person?.isActive ? person.name : null;
}

/** The project as people read it: its name, then the director and manager. The code is left out (still searchable). */
export function projectDisplayLabel(project: PickableProject): string {
  const people = [
    activeName(project.director) ? `PD: ${activeName(project.director)}` : null,
    activeName(project.manager) ? `PM: ${activeName(project.manager)}` : null,
  ].filter(Boolean);
  return [project.name, ...people].join(" · ");
}

/**
 * Pick a project from a long list. Each one shows its name with the Project Director and Project Manager; typing
 * searches the code, the name and both people. `emptyLabel` is the "no project" choice (left out when null).
 */
export default function ProjectPicker({
  id,
  value,
  projects,
  onChange,
  emptyLabel,
  placeholder = "Select a project",
  disabled = false,
}: {
  id?: string;
  value: string;
  projects: PickableProject[];
  onChange: (projectId: string) => void;
  emptyLabel: string | null;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = projects.find((project) => project.id === value) ?? null;

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
    if (terms.length === 0) return projects;
    return projects.filter((project) => {
      const text = [project.code, project.name, activeName(project.director), activeName(project.manager)].filter(Boolean).join(" ").toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [projects, query]);

  function choose(projectId: string) {
    onChange(projectId);
    setOpen(false);
    setQuery("");
  }

  const buttonText = selected ? projectDisplayLabel(selected) : value === "" && emptyLabel !== null && emptyLabel !== placeholder ? emptyLabel : placeholder;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex min-h-[42px] w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 text-left text-sm outline-none transition focus:ring-2 focus:ring-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${
          open ? "border-cyan-400" : "border-slate-300 hover:border-slate-400"
        }`}
      >
        <span className={`min-w-0 truncate ${selected ? "text-slate-900" : "text-slate-500"}`}>{buttonText}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && !disabled ? (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
          <div className="flex h-10 items-center gap-2 border-b border-slate-100 px-3">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search code, name, director or manager..."
              aria-label="Search projects"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5" role="listbox">
            {emptyLabel !== null && !query ? (
              <button
                type="button"
                role="option"
                aria-selected={value === ""}
                onClick={() => choose("")}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${value === "" ? "bg-cyan-50 text-cyan-950" : "text-slate-500 hover:bg-slate-50"}`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">{value === "" ? <Check className="h-3.5 w-3.5" /> : null}</span>
                {emptyLabel}
              </button>
            ) : null}
            {matches.length === 0 ? <p className="px-3 py-3 text-sm text-slate-500">No matching projects.</p> : null}
            {matches.map((project) => {
              const checked = project.id === value;
              const director = activeName(project.director);
              const manager = activeName(project.manager);
              return (
                <button
                  key={project.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => choose(project.id)}
                  className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${checked ? "bg-cyan-50 text-cyan-950" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">{checked ? <Check className="h-3.5 w-3.5" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{project.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      PD: <span className={director ? "text-slate-700" : "text-amber-700"}>{director ?? "not set"}</span>
                      {"  ·  "}
                      PM: <span className={manager ? "text-slate-700" : "text-amber-700"}>{manager ?? "not set"}</span>
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
