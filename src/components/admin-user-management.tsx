"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callApi, callApiWithDeactivationConfirmation } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type UserType = { id: string; code: string; name: string };
type UserRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  canBulkApprove: boolean;
  userType: UserType;
  assignmentCount: number;
  createdAt: string;
};

const emptyForm = { name: "", email: "", password: "", userTypeId: "" };

/**
 * Users and their fixed user type. The type is chosen once, when the account is created.
 * Roles and scope (what each person may do and see) are managed in Roles & Access.
 */
export default function AdminUserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userTypes, setUserTypes] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ users: UserRow[]; userTypes: UserType[] }>("/api/admin/users");
    if (result.ok) {
      setUsers(result.data.users);
      setUserTypes(result.data.userTypes);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(user: UserRow) {
    setEditingId(user.id);
    setForm({ name: user.name, email: user.email, password: "", userTypeId: user.userType.id });
    setError(null);
    setNotice(null);
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const result = editingId
      ? await callApi("/api/admin/users", "PATCH", { id: editingId, name: form.name, email: form.email, password: form.password || undefined, userTypeId: form.userTypeId })
      : await callApi("/api/admin/users", "POST", form);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    setNotice(editingId ? "User updated." : "User created.");
    reset();
    await load();
  }

  async function toggleActive(user: UserRow) {
    setError(null);
    setNotice(null);
    const result = user.isActive
      ? await callApiWithDeactivationConfirmation("/api/admin/users", { id: user.id, name: user.name, email: user.email, isActive: false })
      : await callApi("/api/admin/users", "PATCH", { id: user.id, name: user.name, email: user.email, isActive: true });
    if ("cancelled" in result && result.cancelled) return;
    if (!result.ok) return setError(result.message);
    await load();
  }

  // Switch on: this user may select several pending documents and approve them together. Off: one document at a time.
  async function toggleBulkApprove(user: UserRow) {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/users", "PATCH", { id: user.id, name: user.name, email: user.email, canBulkApprove: !user.canBulkApprove });
    if (!result.ok) return setError(result.message);
    await load();
  }

  async function remove(user: UserRow) {
    if (!window.confirm(`Delete ${user.name}? This cannot be undone.`)) return;
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/users", "DELETE", { id: user.id });
    if (!result.ok) return setError(result.message);
    setNotice("User deleted.");
    await load();
  }

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title={editingId ? "Edit user" : "Create user"} subtitle="A user's type (Clerk, Engineer, Manager or Admin) is fixed when the account is created.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Full name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
          </Field>
          <Field label="User type">
            <select value={form.userTypeId} disabled={Boolean(editingId)} onChange={(e) => setForm({ ...form, userTypeId: e.target.value })} className={inputClass}>
              <option value="">Select a user type</option>
              {userTypes.map((type) => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </select>
          </Field>
          <Field label={editingId ? "New password (leave empty to keep)" : "Password"} hint="At least 12 characters with a letter, a number and a special character.">
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} autoComplete="new-password" />
          </Field>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={save} disabled={saving} className={primaryButton}>{saving ? "Saving..." : editingId ? "Save changes" : "Create user"}</button>
          {editingId ? <button type="button" onClick={reset} className={secondaryButton}>Cancel</button> : null}
        </div>
      </Card>

      <Card title="Users" subtitle="Deactivate an account to block sign-in without losing its history.">
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : users.length === 0 ? (
          <Empty>No users yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Access</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Approve several at once</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-medium text-slate-900">{user.name}</td>
                    <td className="px-3 py-3 text-slate-600">{user.email}</td>
                    <td className="px-3 py-3"><Pill>{user.userType.name}</Pill></td>
                    <td className="px-3 py-3">
                      <Link href={`/admin/roles?userId=${user.id}`} className="text-cyan-700 hover:underline">
                        {user.assignmentCount} role assignment{user.assignmentCount === 1 ? "" : "s"}
                      </Link>
                    </td>
                    <td className="px-3 py-3"><Pill tone={user.isActive ? "green" : "amber"}>{user.isActive ? "Active" : "Deactivated"}</Pill></td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={user.canBulkApprove}
                        aria-label={`Allow ${user.name} to approve several documents at once`}
                        title={user.canBulkApprove ? "On: can approve several documents at once" : "Off: must review documents one by one"}
                        onClick={() => toggleBulkApprove(user)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${user.canBulkApprove ? "bg-cyan-600" : "bg-slate-300"}`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${user.canBulkApprove ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => startEdit(user)} className={secondaryButton}>Edit</button>
                        <button type="button" onClick={() => toggleActive(user)} className={secondaryButton}>{user.isActive ? "Deactivate" : "Activate"}</button>
                        <button type="button" onClick={() => remove(user)} className={dangerButton}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
