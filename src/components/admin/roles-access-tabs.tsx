"use client";

import { useState, type ReactNode } from "react";

type Tab = "assignments" | "roles";

/**
 * Roles & Access shows one part at a time instead of one long page: who holds which role (assignments), or the roles
 * and their permissions. Both stay loaded, so switching back and forth keeps what you typed. The open tab is kept in
 * the address (?tab=roles) so a reload or a shared link opens the same one.
 */
export default function RolesAccessTabs({ initialTab, assignments, roles }: { initialTab: Tab; assignments: ReactNode; roles: ReactNode }) {
  const [tab, setTab] = useState<Tab>(initialTab);

  function choose(next: Tab) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === "assignments") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url.toString());
    } catch {
      // Address not updated; the tab still switches.
    }
  }

  const tabs: Array<{ value: Tab; label: string; hint: string }> = [
    { value: "assignments", label: "Assignments", hint: "Who holds which role, and where" },
    { value: "roles", label: "Roles & permissions", hint: "What each role may do" },
  ];

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Roles and access">
        {tabs.map((item) => {
          const active = tab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => choose(item.value)}
              className={`rounded-xl border px-4 py-2.5 text-left shadow-sm transition ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className={`block text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>{item.hint}</span>
            </button>
          );
        })}
      </nav>
      <div role="tabpanel" hidden={tab !== "assignments"}>{assignments}</div>
      <div role="tabpanel" hidden={tab !== "roles"}>{roles}</div>
    </div>
  );
}
