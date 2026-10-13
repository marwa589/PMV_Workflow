"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton } from "@/components/admin/admin-ui";

type Named = { id: string; name: string };
type Coded = { id: string; code: string; name: string };
type Assignment = {
  id: string;
  user: { id: string; name: string; email: string };
  role: Named;
  company: Named | null;
  project: Coded | null;
  location: Named | null;
  documentType: Coded | null;
  documentSubtype: Coded | null;
  processDefinition: Named | null;
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

const blank = { userId: "", roleId: "", companyId: "", projectId: "", locationId: "", documentTypeId: "", documentSubtypeId: "", processDefinitionId: "" };

/**
 * One row: this user holds this role, limited to the scope columns that are set.
 * An empty scope column means no restriction on that item.
 */
export default function AssignmentsManager({ initialUserId = "" }: { initialUserId?: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [filterUserId, setFilterUserId] = useState(initialUserId);
  const [form, setForm] = useState({ ...blank, userId: initialUserId });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<Lookups & { assignments: Assignment[] }>(`/api/admin/assignments${filterUserId ? `?userId=${encodeURIComponent(filterUserId)}` : ""}`);
    if (!result.ok) return setError(result.message);
    setAssignments(result.data.assignments);
    setLookups(result.data);
  }, [filterUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedType = lookups?.documentTypes.find((type) => type.id === form.documentTypeId);

  async function create() {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/assignments", "POST", Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value || null])));
    if (!result.ok) return setError(result.message);
    setNotice("Role assigned.");
    setForm({ ...blank, userId: form.userId });
    await load();
  }

  async function remove(item: Assignment) {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/assignments", "DELETE", { id: item.id });
    if (!result.ok) return setError(result.message);
    setNotice("Assignment removed.");
    await load();
  }

  const scopeText = (item: Assignment) => {
    const parts = [
      item.company && `Company: ${item.company.name}`,
      item.location && `Location: ${item.location.name}`,
      item.project && `Project: ${item.project.code}`,
      item.documentType && `Type: ${item.documentType.name}`,
      item.documentSubtype && `Sub type: ${item.documentSubtype.name}`,
      item.processDefinition && `Process: ${item.processDefinition.name}`,
    ].filter(Boolean) as string[];
    return parts.length ? parts : ["Everything (no restriction)"];
  };

  const scopeSelect = (label: string, key: keyof typeof blank, options: Array<{ id: string; label: string }>, empty: string, extra?: Partial<{ disabled: boolean; onChange: (value: string) => void }>) => (
    <Field label={label}>
      <select value={form[key]} disabled={extra?.disabled} onChange={(e) => (extra?.onChange ? extra.onChange(e.target.value) : setForm({ ...form, [key]: e.target.value }))} className={inputClass}>
        <option value="">{empty}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </Field>
  );

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title="Give a role to a user" subtitle="For example: role Editor, document type Material Req, project P1 means “may edit Material Req documents in P1”. A user of a flow-named type also needs an assignment covering a document's project to act on it.">
        {lookups ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {scopeSelect("User", "userId", lookups.users.map((user) => ({ id: user.id, label: `${user.name} (${user.userType.name})` })), "Select a user")}
              {scopeSelect("Role", "roleId", lookups.roles.map((role) => ({ id: role.id, label: role.name })), "Select a role")}
              {scopeSelect("Company", "companyId", lookups.companies.map((company) => ({ id: company.id, label: company.name })), "Any company")}
              {scopeSelect("Location", "locationId", lookups.locations.map((location) => ({ id: location.id, label: location.name })), "Any location")}
              {scopeSelect("Project", "projectId", lookups.projects.map((project) => ({ id: project.id, label: `${project.code} - ${project.name}` })), "Any project")}
              {scopeSelect("Document type", "documentTypeId", lookups.documentTypes.map((type) => ({ id: type.id, label: type.name })), "Any document type", { onChange: (value) => setForm({ ...form, documentTypeId: value, documentSubtypeId: "" }) })}
              {scopeSelect("Sub type", "documentSubtypeId", (selectedType?.subtypes ?? []).map((subtype) => ({ id: subtype.id, label: subtype.name })), "Any sub type", { disabled: !selectedType || selectedType.subtypes.length === 0 })}
              {scopeSelect("Process", "processDefinitionId", lookups.processes.map((process) => ({ id: process.id, label: process.name })), "Any process")}
            </div>
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
            <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className={`${inputClass} w-64`}>
              <option value="">All users</option>
              {lookups.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          ) : null
        }
      >
        {assignments.length === 0 ? <Empty>No assignments.</Empty> : null}
        <div className="space-y-2">
          {assignments.map((item) => (
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
