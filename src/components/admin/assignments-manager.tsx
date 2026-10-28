"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton } from "@/components/admin/admin-ui";

type Named = { id: string; name: string };
type Coded = Named & { code: string };
type AssignmentTypeScope = {
  documentType: Coded;
  allSubtypes: boolean;
  subtypes: Coded[];
};
type Assignment = {
  id: string;
  user: { id: string; name: string; email: string };
  role: Named;
  company: Named | null;
  location: Named | null;
  projects: Coded[];
  documentTypeScopes: AssignmentTypeScope[];
  processes: Named[];
};
type TypeOption = Coded & { subtypes: Coded[] };
type Lookups = {
  users: Array<{ id: string; name: string; email: string; userType: { code: string; name: string } }>;
  roles: Named[];
  companies: Named[];
  projects: Coded[];
  locations: Named[];
  documentTypes: TypeOption[];
  processes: Named[];
};
type FormState = {
  userId: string;
  roleId: string;
  companyId: string;
  locationId: string;
  projectIds: string[];
  documentTypeScopes: Array<{ documentTypeId: string; allSubtypes: boolean; subtypeIds: string[] }>;
  processDefinitionIds: string[];
};

const blank = (userId = ""): FormState => ({
  userId,
  roleId: "",
  companyId: "",
  locationId: "",
  projectIds: [],
  documentTypeScopes: [],
  processDefinitionIds: [],
});

function MultiSelect({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: Array<{ id: string; label: string }>;
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const selected = new Set(values);
  const filteredOptions = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedOptions = options.filter((option) => selected.has(option.id));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={dropdownRef} className="relative min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</span>
        <span className="text-xs font-medium text-slate-500">{values.length ? `${values.length} selected` : "No restriction"}</span>
      </div>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-cyan-200 ${
          open ? "border-cyan-400" : "border-slate-300 hover:border-slate-400"
        }`}
      >
        <span className={`min-w-0 truncate ${selectedOptions.length ? "text-slate-800" : "text-slate-400"}`}>
          {selectedOptions.length
            ? selectedOptions.length === 1
              ? selectedOptions[0].label
              : `${selectedOptions.length} selected`
            : `Any ${label.toLowerCase()}`}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {selectedOptions.length ? (
            <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-800">{selectedOptions.length}</span>
          ) : null}
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5">
          <div className="flex h-10 items-center gap-2 border-b border-slate-100 px-3">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              aria-label={`Search ${label.toLowerCase()}`}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label={`Clear ${label.toLowerCase()} search`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5" role="listbox" aria-multiselectable="true" aria-label={label}>
            {filteredOptions.length ? filteredOptions.map((option) => {
              const checked = selected.has(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => onChange(checked ? values.filter((id) => id !== option.id) : [...values, option.id])}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                    checked ? "bg-cyan-50 text-cyan-950" : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked ? "border-cyan-700 bg-cyan-700 text-white" : "border-slate-300 bg-white"
                  }`}>
                    {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            }) : (
              <p className="px-3 py-3 text-sm text-slate-500">{options.length ? "No matching options." : `No ${label.toLowerCase()} available.`}</p>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            <button type="button" onClick={() => onChange([])} disabled={!values.length} className="text-xs font-medium text-slate-500 transition hover:text-slate-800 disabled:cursor-default disabled:opacity-40">
              Clear
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700">
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One role assignment can cover several projects, processes, and document types. Each document type
 * independently covers all subtypes or only the explicitly selected subtypes.
 */
export default function AssignmentsManager({ initialUserId = "" }: { initialUserId?: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [filterUserId, setFilterUserId] = useState(initialUserId);
  const [assignmentQuery, setAssignmentQuery] = useState("");
  const [form, setForm] = useState<FormState>(() => blank(initialUserId));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    () => callApi<Lookups & { assignments: Assignment[] }>(`/api/admin/assignments${filterUserId ? `?userId=${encodeURIComponent(filterUserId)}` : ""}`),
    [filterUserId],
  );

  const applyLoadResult = useCallback((result: Awaited<ReturnType<typeof load>>) => {
    if (!result.ok) return setError(result.message);
    setAssignments(result.data.assignments);
    setLookups(result.data);
  }, []);

  useEffect(() => {
    let active = true;
    void load().then((result) => {
      if (active) applyLoadResult(result);
    });
    return () => {
      active = false;
    };
  }, [applyLoadResult, load]);

  async function create() {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/assignments", "POST", {
      ...form,
      companyId: form.companyId || null,
      locationId: form.locationId || null,
    });
    if (!result.ok) return setError(result.message);
    setNotice("Role assigned.");
    setForm(blank(form.userId));
    applyLoadResult(await load());
  }

  async function remove(item: Assignment) {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/assignments", "DELETE", { id: item.id });
    if (!result.ok) return setError(result.message);
    setNotice("Assignment removed.");
    applyLoadResult(await load());
  }

  const setSelectedTypes = (ids: string[]) => {
    setForm((current) => ({
      ...current,
      documentTypeScopes: ids.map((documentTypeId) =>
        current.documentTypeScopes.find((scope) => scope.documentTypeId === documentTypeId) ?? {
          documentTypeId,
          allSubtypes: true,
          subtypeIds: [],
        },
      ),
    }));
  };

  const scopeText = (item: Assignment) => {
    const parts = [
      item.company && `Company: ${item.company.name}`,
      item.location && `Location: ${item.location.name}`,
      ...item.projects.map((project) => `Project: ${project.code}`),
      ...item.documentTypeScopes.map((scope) =>
        scope.allSubtypes
          ? `Type: ${scope.documentType.name} (all subtypes)`
          : `Type: ${scope.documentType.name} (${scope.subtypes.map((subtype) => subtype.name).join(", ")})`,
      ),
      ...item.processes.map((process) => `Process: ${process.name}`),
    ].filter(Boolean) as string[];
    return parts.length ? parts : ["Everything (no restriction)"];
  };

  // Live search as you type: every word must appear in the user, email, role or scope (project, type, process...).
  const visibleAssignments = useMemo(() => {
    const terms = assignmentQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return assignments;
    return assignments.filter((item) => {
      const text = [item.user.name, item.user.email, item.role.name, ...scopeText(item)].join(" ").toLowerCase();
      return terms.every((term) => text.includes(term));
    });
    // scopeText only reads the item it is given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, assignmentQuery]);

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title="Give a role to a user" subtitle="Leave a scope empty for no restriction. Multiple projects, document types, and processes can be selected; subtype access is configured separately for each document type.">
        {lookups ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="User">
                <select value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} className={inputClass}>
                  <option value="">Select a user</option>
                  {lookups.users.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.userType.name})</option>)}
                </select>
              </Field>
              <Field label="Role">
                <select value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })} className={inputClass}>
                  <option value="">Select a role</option>
                  {lookups.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </Field>
              <Field label="Company">
                <select value={form.companyId} onChange={(event) => setForm({ ...form, companyId: event.target.value })} className={inputClass}>
                  <option value="">Any company</option>
                  {lookups.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
              </Field>
              <Field label="Location">
                <select value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })} className={inputClass}>
                  <option value="">Any location</option>
                  {lookups.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </Field>
              <MultiSelect
                label="Projects"
                values={form.projectIds}
                options={lookups.projects.map((project) => ({ id: project.id, label: `${project.code} - ${project.name}` }))}
                onChange={(projectIds) => setForm({ ...form, projectIds })}
              />
              <MultiSelect
                label="Document types"
                values={form.documentTypeScopes.map((scope) => scope.documentTypeId)}
                options={lookups.documentTypes.map((type) => ({ id: type.id, label: type.name }))}
                onChange={setSelectedTypes}
              />
              <MultiSelect
                label="Processes"
                values={form.processDefinitionIds}
                options={lookups.processes.map((process) => ({ id: process.id, label: process.name }))}
                onChange={(processDefinitionIds) => setForm({ ...form, processDefinitionIds })}
              />
            </div>

            {form.documentTypeScopes.length > 0 ? (
              <div className="mt-5 space-y-3 rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Subtype access by document type</h3>
                {form.documentTypeScopes.map((scope) => {
                  const type = lookups.documentTypes.find((candidate) => candidate.id === scope.documentTypeId);
                  if (!type) return null;
                  return (
                    <div key={scope.documentTypeId} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{type.name}</p>
                        <span className="text-xs text-slate-500">
                          {scope.allSubtypes ? "All subtypes" : `${scope.subtypeIds.length} selected`}
                        </span>
                      </div>
                      {type.subtypes.length > 0 ? (
                        <>
                          <div className="flex flex-wrap gap-2">
                            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                              scope.allSubtypes ? "border-cyan-300 bg-cyan-50 text-cyan-950" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                            }`}>
                              <input
                                type="radio"
                                name={`subtype-mode-${scope.documentTypeId}`}
                                checked={scope.allSubtypes}
                                onChange={() => setForm((current) => ({
                                  ...current,
                                  documentTypeScopes: current.documentTypeScopes.map((entry) =>
                                    entry.documentTypeId === scope.documentTypeId
                                      ? { ...entry, allSubtypes: true, subtypeIds: [] }
                                      : entry,
                                  ),
                                }))}
                                className="accent-cyan-700"
                              />
                              All subtypes
                            </label>
                            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                              !scope.allSubtypes ? "border-cyan-300 bg-cyan-50 text-cyan-950" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                            }`}>
                              <input
                                type="radio"
                                name={`subtype-mode-${scope.documentTypeId}`}
                                checked={!scope.allSubtypes}
                                onChange={() => setForm((current) => ({
                                  ...current,
                                  documentTypeScopes: current.documentTypeScopes.map((entry) =>
                                    entry.documentTypeId === scope.documentTypeId
                                      ? { ...entry, allSubtypes: false }
                                      : entry,
                                  ),
                                }))}
                                className="accent-cyan-700"
                              />
                              Choose subtypes
                            </label>
                          </div>
                          {!scope.allSubtypes ? (
                            <MultiSelect
                              label={`${type.name} subtypes`}
                              values={scope.subtypeIds}
                              options={type.subtypes.map((subtype) => ({ id: subtype.id, label: subtype.name }))}
                              onChange={(subtypeIds) => setForm((current) => ({
                                ...current,
                                documentTypeScopes: current.documentTypeScopes.map((entry) =>
                                  entry.documentTypeId === scope.documentTypeId
                                    ? { ...entry, allSubtypes: false, subtypeIds }
                                    : entry,
                                ),
                              }))}
                            />
                          ) : null}
                        </>
                      ) : (
                        <p className="text-sm text-slate-500">No subtypes are configured. This type has no subtype restriction.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-4">
              <button type="button" className={primaryButton} disabled={!form.userId || !form.roleId} onClick={create}>Assign role</button>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">Loading...</p>
        )}
      </Card>

      <Card
        title="Assignments"
        actions={
          lookups ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={assignmentQuery}
                onChange={(event) => setAssignmentQuery(event.target.value)}
                placeholder="Search by user, role or scope"
                aria-label="Search assignments"
                className={`${inputClass} w-64`}
              />
              <select value={filterUserId} onChange={(event) => setFilterUserId(event.target.value)} className={`${inputClass} w-64`}>
                <option value="">All users</option>
                {lookups.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
            </div>
          ) : null
        }
      >
        {assignments.length === 0 ? <Empty>No assignments.</Empty> : null}
        {assignments.length > 0 && visibleAssignments.length === 0 ? <Empty>No assignments match &quot;{assignmentQuery}&quot;.</Empty> : null}
        <div className="space-y-2">
          {visibleAssignments.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <div className="space-y-1">
                <p><span className="font-medium text-slate-900">{item.user.name}</span> <span className="text-slate-500">holds</span> <Pill>{item.role.name}</Pill></p>
                <div className="flex flex-wrap gap-2">{scopeText(item).map((text) => <Pill key={text} tone="green">{text}</Pill>)}</div>
              </div>
              <button type="button" className={dangerButton} onClick={() => remove(item)}>Remove</button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
