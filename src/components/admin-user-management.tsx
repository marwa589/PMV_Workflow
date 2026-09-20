"use client";

import { useState } from "react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";
import { Plus, Trash2, ShieldCheck, Building2 } from "lucide-react";

type Role = "CLERK" | "APPROVER_1" | "APPROVER_2" | "APPROVER_3" | "ADMIN" | "ERR_USER";
type UserLocationType = "AVR" | "AVK" | "KUWAIT";
type ErrRole = "UPLOADER" | "PROJECT_DIRECTOR" | "ACTING_CEO" | "CEO" | "VIEWER";
type ErrProjectCountry = "KSA" | "KUWAIT";

type ErrAccessItem = {
  id?: string;
  role: ErrRole;
  projectId: string | null;
  newProjectName?: string | null;
  projectName?: string | null;
  country?: ErrProjectCountry | null;
};

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  location: UserLocationType;
  projectName?: string | null;
  errAccessRoles: ErrRole[];
  errAccess?: ErrAccessItem[];
  createdAt: string;
};

type ProjectOption = {
  id: string;
  name: string;
  country?: ErrProjectCountry;
};

const roleOptions: Array<{ value: Role; label: string }> = [
  { value: "CLERK", label: "Clerk" },
  { value: "APPROVER_1", label: "PMV Engineer" },
  { value: "APPROVER_2", label: "Workshop Manager" },
  { value: "APPROVER_3", label: "PMV Manager" },
  { value: "ADMIN", label: "Admin" },
  { value: "ERR_USER", label: "ERR User" },
];

const errRoleOptions: Array<{ value: ErrRole; label: string; defaultProjectRequired?: boolean }> = [
  { value: "UPLOADER", label: "ERR Uploader" },
  { value: "PROJECT_DIRECTOR", label: "Project Director", defaultProjectRequired: true },
  { value: "ACTING_CEO", label: "Acting CEO" },
  { value: "CEO", label: "CEO" },
  { value: "VIEWER", label: "ERR Viewer" },
];

const countryOptions: Array<{ value: ErrProjectCountry; label: string }> = [
  { value: "KSA", label: "KSA" },
  { value: "KUWAIT", label: "KUWAIT" },
];

const locationOptions: Array<{ value: UserLocationType; label: string }> = [
  { value: "AVR", label: "AVR" },
  { value: "AVK", label: "AVK" },
  { value: "KUWAIT", label: "KUWAIT" },
];

const emptyForm = {
  name: "",
  email: "",
  password: "",
  role: "CLERK" as Role,
  location: "KUWAIT" as UserLocationType,
  projectName: "",
  errAccess: [] as ErrAccessItem[],
};

export default function AdminUserManagement({
  initialUsers,
  projects = [],
}: {
  initialUsers: User[];
  projects?: ProjectOption[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const [projectsList, setProjectsList] = useState<ProjectOption[]>(projects);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New grant builder state
  const [selectedNewRole, setSelectedNewRole] = useState<ErrRole>("PROJECT_DIRECTOR");
  const [selectedNewProjectId, setSelectedNewProjectId] = useState<string>("");
  const [newProjectName, setNewProjectName] = useState<string>("");
  const [selectedNewCountry, setSelectedNewCountry] = useState<ErrProjectCountry>("KUWAIT");

  function updateField(field: "name" | "email" | "password" | "role" | "location" | "projectName", value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "role" && value !== "ERR_USER" ? { errAccess: [] } : {}),
    }));
  }

  function startEdit(user: User) {
    setEditingId(user.id);
    setForm({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      location: user.location || "KUWAIT",
      projectName: user.projectName || "",
      errAccess: user.errAccess ? [...user.errAccess] : (user.errAccessRoles || []).map((r) => ({ role: r, projectId: null })),
    });
    setError(null);
    setMessage(null);
    setSelectedNewRole("PROJECT_DIRECTOR");
    setSelectedNewProjectId("");
    setNewProjectName("");
    setSelectedNewCountry("KUWAIT");
  }

  function addGrant() {
    setError(null);

    // Validate country selection
    if (!selectedNewCountry) {
      setError("Please select a country.");
      return;
    }

    if (selectedNewProjectId === "__NEW__") {
      const trimmedName = newProjectName.trim();
      if (!trimmedName) {
        setError("Please enter a name for the new project.");
        return;
      }

      // Check if project already exists in project list
      const existingProject = projectsList.find(
        (p) => p.name.trim().toLowerCase() === trimmedName.toLowerCase(),
      );

      const targetProjectId = existingProject ? existingProject.id : null;
      const targetProjectName = existingProject ? existingProject.name : trimmedName;

      const exists = form.errAccess.some(
        (g) =>
          g.role === selectedNewRole &&
          ((targetProjectId && g.projectId === targetProjectId) ||
            (!targetProjectId && g.newProjectName?.toLowerCase() === trimmedName.toLowerCase()) ||
            g.projectName?.toLowerCase() === trimmedName.toLowerCase()),
      );

      if (exists) {
        setError(`This user already has ${selectedNewRole} access for project '${targetProjectName}'.`);
        return;
      }

      setForm((current) => ({
        ...current,
        errAccess: [
          ...current.errAccess,
          {
            role: selectedNewRole,
            projectId: targetProjectId,
            newProjectName: targetProjectId ? null : trimmedName,
            projectName: targetProjectName,
            country: selectedNewCountry,
          },
        ],
      }));

      setSelectedNewProjectId("");
      setNewProjectName("");
      return;
    }

    const projectId = selectedNewProjectId.trim() || null;
    const project = projectsList.find((p) => p.id === projectId);

    const exists = form.errAccess.some(
      (g) => g.role === selectedNewRole && (g.projectId ?? null) === projectId,
    );

    if (exists) {
      setError(`This user already has ${selectedNewRole} access for ${project ? project.name : "All Projects (Global)"}.`);
      return;
    }

    setForm((current) => ({
      ...current,
      errAccess: [
        ...current.errAccess,
        {
          role: selectedNewRole,
          projectId,
          projectName: project?.name ?? null,
          country: projectId ? (project?.country || "KUWAIT") : null,
        },
      ],
    }));
  }

  function removeGrant(index: number) {
    setForm((current) => ({
      ...current,
      errAccess: current.errAccess.filter((_, i) => i !== index),
    }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedNewRole("PROJECT_DIRECTOR");
    setSelectedNewProjectId("");
    setNewProjectName("");
    setSelectedNewCountry("KUWAIT");
  }

  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    const payload = {
      ...(editingId ? { id: editingId } : {}),
      name: form.name,
      email: form.email,
      password: form.password,
      role: form.role,
      location: form.location,
      projectName: form.projectName.trim(),
      errAccess:
        form.role === "ERR_USER"
          ? form.errAccess.map((g) => ({
              role: g.role,
              projectId: g.projectId,
              newProjectName: g.newProjectName,
              country: g.country,
            }))
          : [],
    };

    try {
      const response = await fetch("/api/admin/users", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        user?: User;
        projects?: ProjectOption[];
        message?: string;
      };
      if (!response.ok || !result.user) throw new Error(result.message || "Unable to save user.");
      const savedUser = result.user;

      if (result.projects && Array.isArray(result.projects)) {
        setProjectsList(result.projects);
      }

      setUsers((current) =>
        editingId
          ? current.map((user) => (user.id === savedUser.id ? savedUser : user))
          : [savedUser, ...current],
      );
      setMessage(editingId ? "User updated." : "User created.");
      resetForm();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save user.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(user: User) {
    if (!window.confirm(`Delete ${user.name}'s account? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify({ id: user.id }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to delete user.");
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setMessage(result.message || "User deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete user.");
    } finally {
      setBusy(false);
    }
  }

  function formatAccessSummary(user: User) {
    if (user.role !== "ERR_USER") {
      return roleOptions.find((r) => r.value === user.role)?.label || user.role;
    }

    if (!user.errAccess || user.errAccess.length === 0) {
      if (user.errAccessRoles && user.errAccessRoles.length > 0) {
        return user.errAccessRoles.map((r) => errRoleOptions.find((o) => o.value === r)?.label || r).join(", ");
      }
      return "ERR User (No grants)";
    }

    return user.errAccess
      .map((grant) => {
        const roleLabel = errRoleOptions.find((o) => o.value === grant.role)?.label || grant.role;
        const projectLabel =
          grant.projectName ||
          grant.newProjectName ||
          (grant.projectId ? projectsList.find((p) => p.id === grant.projectId)?.name || "Specific Project" : "Global");
        const countryLabel = grant.country || "KUWAIT";
        return `${roleLabel} (${projectLabel} - ${countryLabel})`;
      })
      .join(", ");
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-900">{editingId ? "Edit User" : "Add User"}</h2>
          <p className="mt-1 text-sm text-slate-500">The selected role controls the user&apos;s dashboard and available pages.</p>
        </div>
        <form onSubmit={submitForm} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Name
            <input
              required
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-slate-500"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Email
            <input
              required
              type="email"
              value={form.email}
              onChange={(event) => updateField("email", event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-slate-500"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Role
            <select
              value={form.role}
              onChange={(event) => updateField("role", event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-slate-500"
            >
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Location
            <select
              required
              value={form.location}
              onChange={(event) => updateField("location", event.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-slate-500"
            >
              {locationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700 md:col-span-2">
            Project (optional)
            <input
              value={form.projectName}
              onChange={(event) => updateField("projectName", event.target.value)}
              placeholder="Optional project or department name"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-slate-500"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {editingId ? "New password (optional)" : "Initial password"}
            <input
              required={!editingId}
              type="password"
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              placeholder={editingId ? "Leave blank to keep current password" : "At least 12 characters"}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-slate-500"
            />
          </label>

          {form.role === "ERR_USER" ? (
            <fieldset className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <legend className="text-sm font-semibold text-slate-800 flex items-center gap-2 px-1">
                <ShieldCheck className="h-4 w-4 text-indigo-600" />
                ERR Project-Specific & Global Roles
              </legend>

              <div className="mt-3 space-y-3">
                {/* Existing grants */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Assigned Responsibilities ({form.errAccess.length})
                  </p>
                  {form.errAccess.length === 0 ? (
                    <p className="mt-1 text-sm text-slate-500 italic">No ERR responsibilities assigned yet.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {form.errAccess.map((grant, index) => {
                        const rLabel = errRoleOptions.find((o) => o.value === grant.role)?.label || grant.role;
                        const pLabel =
                          grant.projectName ||
                          (grant.projectId ? projects.find((p) => p.id === grant.projectId)?.name || "Specific Project" : "Global / All Projects");
                        const countryLabel = grant.country || "KUWAIT";

                        return (
                          <div
                            key={index}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-2xs"
                          >
                            <span className="font-medium text-slate-900">{rLabel}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                              {pLabel}
                            </span>
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 font-medium">
                              {countryLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeGrant(index)}
                              className="text-slate-400 hover:text-rose-600"
                              title="Remove grant"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Add new grant */}
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <p className="text-xs font-semibold text-slate-700">Add Responsibility Grant</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <select
                      value={selectedNewRole}
                      onChange={(e) => setSelectedNewRole(e.target.value as ErrRole)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      {errRoleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={selectedNewProjectId}
                      onChange={(e) => setSelectedNewProjectId(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 max-w-xs truncate"
                    >
                      <option value="">Global (All Projects / Whole System)</option>
                      <optgroup label="Existing Projects">
                        {projectsList.map((proj) => (
                          <option key={proj.id} value={proj.id}>
                            Project: {proj.name}
                          </option>
                        ))}
                      </optgroup>
                      <option value="__NEW__">+ Create New Project...</option>
                    </select>

                    {selectedNewProjectId === "__NEW__" ? (
                      <>
                        <input
                          type="text"
                          required
                          placeholder="Enter new project name..."
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 min-w-[220px]"
                        />

                        <select
                          value={selectedNewCountry}
                          onChange={(e) => setSelectedNewCountry(e.target.value as ErrProjectCountry)}
                          className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="">Select Country...</option>
                          {countryOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : selectedNewProjectId ? (
                      <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 font-medium">
                        {projectsList.find((p) => p.id === selectedNewProjectId)?.country || "KUWAIT"}
                      </span>
                    ) : null}

                    <button
                      type="button"
                      onClick={addGrant}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 shadow-2xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Grant
                    </button>
                  </div>
                </div>
              </div>
            </fieldset>
          ) : null}

          <div className="flex gap-2 md:col-span-2 pt-2">
            <button
              disabled={busy}
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Saving..." : editingId ? "Save Changes" : "Add User"}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        {error ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Users</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-5 py-3 font-semibold">Email</th>
                <th className="px-5 py-3 font-semibold">Access</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-5 py-4 font-medium text-slate-900">{user.name}</td>
                  <td className="px-5 py-4 text-slate-700">{user.email}</td>
                  <td className="px-5 py-4 text-slate-700">{formatAccessSummary(user)}</td>
                  <td className="px-5 py-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(user)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteUser(user)}
                        disabled={busy}
                        className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

