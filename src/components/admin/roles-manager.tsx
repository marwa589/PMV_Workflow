"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type Permission = { id: string; code: string; name: string; description?: string | null };
type Role = { id: string; name: string; description: string | null; assignmentCount: number; permissions: Permission[] };

// Permissions are listed in groups: "something.manage" opens an admin area, the rest are grouped by what they act on.
const GROUP_LABELS: Record<string, string> = { documents: "Documents", maintenance: "Maintenance" };
const ADMIN_GROUP = "Administration";

function groupOf(permission: Permission): string {
  if (permission.code.endsWith(".manage")) return ADMIN_GROUP;
  const prefix = permission.code.split(".")[0] ?? "";
  return GROUP_LABELS[prefix] ?? (prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : "Other");
}

function matches(text: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  return terms.every((term) => lower.includes(term));
}

/** A role is a named bundle of permissions. The Approver role has none on purpose: it only sees what a flow names it for. */
export default function RolesManager() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [form, setForm] = useState({ id: null as string | null, name: "", description: "", permissionIds: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [permissionQuery, setPermissionQuery] = useState("");
  const [roleQuery, setRoleQuery] = useState("");
  // Roles whose permission list is unfolded in the list below.
  const [openRoles, setOpenRoles] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ roles: Role[]; permissions: Permission[] }>("/api/admin/roles");
    if (!result.ok) return setError(result.message);
    setRoles(result.data.roles);
    setPermissions(result.data.permissions);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    setForm({ id: null, name: "", description: "", permissionIds: [] });
  }

  async function save() {
    setError(null);
    setNotice(null);
    const payload = { name: form.name, description: form.description, permissionIds: form.permissionIds };
    const result = form.id ? await callApi("/api/admin/roles", "PATCH", { id: form.id, ...payload }) : await callApi("/api/admin/roles", "POST", payload);
    if (!result.ok) return setError(result.message);
    setNotice(form.id ? "Role updated." : "Role created.");
    reset();
    await load();
  }

  async function remove(role: Role) {
    if (!window.confirm(`Delete role ${role.name}?`)) return;
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/roles", "DELETE", { id: role.id });
    if (!result.ok) return setError(result.message);
    setNotice("Role deleted.");
    await load();
  }

  function edit(role: Role) {
    setForm({ id: role.id, name: role.name, description: role.description ?? "", permissionIds: role.permissions.map((p) => p.id) });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggle(permissionId: string) {
    setForm((current) => ({
      ...current,
      permissionIds: current.permissionIds.includes(permissionId) ? current.permissionIds.filter((id) => id !== permissionId) : [...current.permissionIds, permissionId],
    }));
  }

  function setMany(ids: string[], on: boolean) {
    setForm((current) => ({
      ...current,
      permissionIds: on ? [...new Set([...current.permissionIds, ...ids])] : current.permissionIds.filter((id) => !ids.includes(id)),
    }));
  }

  function toggleRole(id: string) {
    setOpenRoles((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Groups in a fixed order: Documents first, Administration last, others by name in between.
  const permissionGroups = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const permission of permissions) {
      if (permissionQuery && !matches(`${permission.name} ${permission.code} ${permission.description ?? ""}`, permissionQuery)) continue;
      const group = groupOf(permission);
      map.set(group, [...(map.get(group) ?? []), permission]);
    }
    const order = (name: string) => (name === "Documents" ? 0 : name === ADMIN_GROUP ? 2 : 1);
    return [...map.entries()]
      .map(([name, items]) => ({ name, items: items.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
  }, [permissions, permissionQuery]);

  const visibleRoles = useMemo(
    () => (roleQuery ? roles.filter((role) => matches(`${role.name} ${role.description ?? ""} ${role.permissions.map((p) => `${p.name} ${p.code}`).join(" ")}`, roleQuery)) : roles),
    [roles, roleQuery],
  );

  const selected = new Set(form.permissionIds);

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <div ref={formRef} className="scroll-mt-6">
        <Card title={form.id ? `Edit role ${form.name}` : "New role"} subtitle="Tick what this role may do. Where it applies (document type, project, process...) is set when you give the role to a user.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></Field>
            <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} /></Field>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">
              Permissions <span className="ml-1 text-xs font-normal text-slate-500">{form.permissionIds.length} of {permissions.length} ticked</span>
            </p>
            <input
              type="search"
              value={permissionQuery}
              onChange={(e) => setPermissionQuery(e.target.value)}
              placeholder="Search permissions"
              aria-label="Search permissions"
              className={`${inputClass} max-w-xs`}
            />
          </div>

          <div className="mt-3 space-y-4">
            {permissionGroups.length === 0 ? <Empty>{permissions.length === 0 ? "No permissions." : `No permissions match "${permissionQuery}".`}</Empty> : null}
            {permissionGroups.map((group) => {
              const ids = group.items.map((permission) => permission.id);
              const ticked = ids.filter((id) => selected.has(id)).length;
              return (
                <div key={group.name} className="rounded-xl border border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                      {group.name} <span className="ml-1 font-normal normal-case tracking-normal text-slate-500">{ticked}/{ids.length}</span>
                    </p>
                    <div className="flex gap-3 text-xs font-medium">
                      <button type="button" className="text-cyan-700 hover:underline disabled:opacity-40" disabled={ticked === ids.length} onClick={() => setMany(ids, true)}>Tick all</button>
                      <button type="button" className="text-slate-500 hover:underline disabled:opacity-40" disabled={ticked === 0} onClick={() => setMany(ids, false)}>Clear</button>
                    </div>
                  </div>
                  {group.name === ADMIN_GROUP ? (
                    <p className="px-4 pt-2 text-xs text-slate-500">These open setup screens for the whole system: a project, company or type limit on the assignment does not narrow them.</p>
                  ) : null}
                  <div className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((permission) => (
                      <label
                        key={permission.id}
                        className={`flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-sm transition ${selected.has(permission.id) ? "bg-cyan-50 text-cyan-950" : "text-slate-700 hover:bg-slate-50"}`}
                        title={permission.code}
                      >
                        <input type="checkbox" checked={selected.has(permission.id)} onChange={() => toggle(permission.id)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
                        <span className="min-w-0">
                          <span className="font-medium text-slate-900">{permission.name}</span>
                          {permission.description ? <span className="mt-0.5 block text-xs text-slate-600">{permission.description}</span> : <span className="block text-xs text-slate-500">{permission.code}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex gap-2">
            <button type="button" className={primaryButton} onClick={save}>{form.id ? "Save role" : "Create role"}</button>
            {form.id ? <button type="button" className={secondaryButton} onClick={reset}>Cancel</button> : null}
          </div>
        </Card>
      </div>

      <Card
        title="Roles"
        subtitle={roles.length ? `${roles.length} role(s). Click a role to see its permissions.` : undefined}
        actions={
          roles.length > 0 ? (
            <input type="search" value={roleQuery} onChange={(e) => setRoleQuery(e.target.value)} placeholder="Search roles or permissions" aria-label="Search roles" className={`${inputClass} w-64`} />
          ) : null
        }
      >
        {roles.length === 0 ? <Empty>No roles yet. Run the seed to create the standard ones.</Empty> : null}
        {roles.length > 0 && visibleRoles.length === 0 ? <Empty>No roles match &quot;{roleQuery}&quot;.</Empty> : null}
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {visibleRoles.map((role) => {
            const open = openRoles.has(role.id) || Boolean(roleQuery);
            return (
              <div key={role.id} className={form.id === role.id ? "bg-cyan-50/40" : undefined}>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <button type="button" onClick={() => toggleRole(role.id)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{role.name}</span>
                      {role.description ? <span className="block truncate text-xs text-slate-500">{role.description}</span> : null}
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    {role.permissions.length === 0 ? <Pill tone="amber">No permissions</Pill> : <Pill>{role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}</Pill>}
                    <span className="text-xs text-slate-500">{role.assignmentCount} assignment(s)</span>
                    <button type="button" className={secondaryButton} onClick={() => edit(role)}>Edit</button>
                    <button type="button" className={dangerButton} onClick={() => remove(role)}>Delete</button>
                  </div>
                </div>
                {open && role.permissions.length > 0 ? (
                  <div className="flex flex-wrap gap-2 px-4 pb-3 pl-10">
                    {role.permissions.map((permission) => (
                      <span key={permission.id} title={permission.code}><Pill>{permission.name}</Pill></span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
