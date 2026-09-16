"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Plus, RotateCcw, UserMinus, X } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

const roles = ["CLERK", "APPROVER_1", "APPROVER_2", "APPROVER_3", "ADMIN"] as const;
type UserRole = (typeof roles)[number];

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
};

type UserForm = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

const emptyForm: UserForm = { name: "", email: "", password: "", role: "CLERK" };

function roleLabel(role: UserRole) {
  return role.replaceAll("_", " ");
}

export default function AdminUserManagement({ initialUsers }: { initialUsers: ManagedUser[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<UserForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function updateForm(setter: typeof setForm, field: keyof UserForm, value: string) {
    setter((current) => ({ ...current, [field]: value }));
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { user?: ManagedUser; message?: string };
      if (!response.ok || !result.user) throw new Error(result.message || "Unable to create user.");
      setUsers((current) => [result.user!, ...current]);
      setForm(emptyForm);
      setNotice("User created.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create user.");
    } finally {
      setBusy(false);
    }
  }

  async function updateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify(editingForm),
      });
      const result = await response.json() as { user?: ManagedUser; message?: string };
      if (!response.ok || !result.user) throw new Error(result.message || "Unable to update user.");
      setUsers((current) => current.map((user) => user.id === result.user!.id ? result.user! : user));
      setEditingId(null);
      setNotice("User updated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update user.");
    } finally {
      setBusy(false);
    }
  }

  async function changeActiveState(user: ManagedUser) {
    const action = user.isActive ? "deactivate" : "reactivate";
    if (user.isActive && !window.confirm(`Deactivate ${user.name}? Their history will be preserved.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: user.isActive ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: user.isActive ? undefined : JSON.stringify({ isActive: true }),
      });
      const result = await response.json() as { message?: string; user?: ManagedUser };
      if (!response.ok) throw new Error(result.message || `Unable to ${action} user.`);
      if (user.isActive) {
        setUsers((current) => current.map((item) => item.id === user.id ? { ...item, isActive: false } : item));
      } else if (result.user) {
        setUsers((current) => current.map((item) => item.id === user.id ? result.user! : item));
      }
      setNotice(`User ${user.isActive ? "deactivated" : "reactivated"}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Unable to ${action} user.`);
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(user: ManagedUser) {
    setError(null);
    setNotice(null);
    setEditingId(user.id);
    setEditingForm({ name: user.name, email: user.email, password: "", role: user.role });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Add user</h3>
          <p className="mt-1 text-sm text-slate-500">New passwords must contain at least 12 characters.</p>
        </div>
        <form onSubmit={createUser} className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5">
          <input value={form.name} onChange={(event) => updateForm(setForm, "name", event.target.value)} placeholder="Full name" required className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          <input value={form.email} onChange={(event) => updateForm(setForm, "email", event.target.value)} type="email" placeholder="Email" required className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          <input value={form.password} onChange={(event) => updateForm(setForm, "password", event.target.value)} type="password" placeholder="Temporary password" minLength={12} required className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          <select value={form.role} onChange={(event) => updateForm(setForm, "role", event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
            {roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </select>
          <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add user
          </button>
        </form>
      </section>

      {(error || notice) && <div className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || notice}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Users</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-3 font-semibold">Name</th><th className="px-5 py-3 font-semibold">Email</th><th className="px-5 py-3 font-semibold">Role</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Actions</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-slate-100">
                  <td className="px-5 py-4 font-medium text-slate-900">{user.name}</td>
                  <td className="px-5 py-4 text-slate-700">{user.email}</td>
                  <td className="px-5 py-4 text-slate-700">{roleLabel(user.role)}</td>
                  <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{user.isActive ? "Active" : "Inactive"}</span></td>
                  <td className="px-5 py-4"><div className="flex gap-2"><button type="button" onClick={() => beginEdit(user)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Edit</button><button type="button" onClick={() => void changeActiveState(user)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{user.isActive ? <UserMinus className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}{user.isActive ? "Deactivate" : "Reactivate"}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingId && <section className="rounded-2xl border border-cyan-200 bg-cyan-50 shadow-sm"><div className="flex items-center justify-between border-b border-cyan-200 px-5 py-4"><div><h3 className="text-base font-semibold text-slate-900">Edit user</h3><p className="mt-1 text-sm text-slate-600">Leave the password blank to keep it unchanged.</p></div><button type="button" onClick={() => setEditingId(null)} className="rounded-lg p-2 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button></div><form onSubmit={updateUser} className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5"><input value={editingForm.name} onChange={(event) => updateForm(setEditingForm, "name", event.target.value)} required className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /><input value={editingForm.email} onChange={(event) => updateForm(setEditingForm, "email", event.target.value)} type="email" required className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /><input value={editingForm.password} onChange={(event) => updateForm(setEditingForm, "password", event.target.value)} type="password" minLength={12} placeholder="New password (optional)" className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /><select value={editingForm.role} onChange={(event) => updateForm(setEditingForm, "role", event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm">{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select><button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes</button></form></section>}
    </div>
  );
}