"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type Permission = { id: string; code: string; name: string; description?: string | null };
type Role = { id: string; name: string; description: string | null; assignmentCount: number; permissions: Permission[] };

/** A role is a named bundle of permissions. The Approver role has none on purpose: it only sees what a flow names it for. */
export default function RolesManager() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [form, setForm] = useState({ id: null as string | null, name: "", description: "", permissionIds: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  function toggle(permissionId: string) {
    setForm((current) => ({
      ...current,
      permissionIds: current.permissionIds.includes(permissionId) ? current.permissionIds.filter((id) => id !== permissionId) : [...current.permissionIds, permissionId],
    }));
  }

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title={form.id ? "Edit role" : "New role"} subtitle="Tick what this role may do. Where it applies (document type, project, process...) is set when you give the role to a user.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></Field>
          <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} /></Field>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {permissions.map((permission) => (
            <label key={permission.id} className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.permissionIds.includes(permission.id)} onChange={() => toggle(permission.id)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
              <span>
                <span className="font-medium text-slate-900">{permission.name}</span>
                <span className="block text-xs text-slate-500">{permission.code}</span>
                {permission.description ? <span className="mt-0.5 block text-xs text-slate-600">{permission.description}</span> : null}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" className={primaryButton} onClick={save}>{form.id ? "Save role" : "Create role"}</button>
          {form.id ? <button type="button" className={secondaryButton} onClick={reset}>Cancel</button> : null}
        </div>
      </Card>

      <Card title="Roles">
        {roles.length === 0 ? <Empty>No roles yet. Run the seed to create the standard ones.</Empty> : null}
        <div className="space-y-3">
          {roles.map((role) => (
            <div key={role.id} className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold text-slate-900">{role.name}</span>
                  <span className="text-xs text-slate-500">held through {role.assignmentCount} assignment(s)</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={secondaryButton} onClick={() => { setForm({ id: role.id, name: role.name, description: role.description ?? "", permissionIds: role.permissions.map((p) => p.id) }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
                  <button type="button" className={dangerButton} onClick={() => remove(role)}>Delete</button>
                </div>
              </div>
              {role.description ? <p className="mt-1 text-sm text-slate-600">{role.description}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {role.permissions.length === 0 ? <Pill tone="amber">No permissions</Pill> : role.permissions.map((permission) => <Pill key={permission.id}>{permission.code}</Pill>)}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
