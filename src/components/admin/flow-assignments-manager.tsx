"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton } from "@/components/admin/admin-ui";

type Assignment = {
  id: string;
  documentType: { id: string; code: string; name: string };
  documentSubtype: { id: string; code: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
  template: { id: string; code: string; name: string } | null;
};
type TypeOption = { id: string; code: string; name: string; subtypes: Array<{ id: string; code: string; name: string }> };
type FlowOption = { id: string; code: string; name: string };
type ProjectOption = { id: string; code: string; name: string };

const AUTO = "__auto__";

/**
 * Decides which flow a document gets. The most specific row wins:
 * 1) project + sub type  2) project + type  3) sub type (all projects)  4) type (all projects).
 * No row, or a row set to "no approval", means the document is approved as soon as it is uploaded.
 */
export default function FlowAssignmentsManager() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [form, setForm] = useState({ documentTypeId: "", documentSubtypeId: "", projectId: "", templateId: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ assignments: Assignment[]; documentTypes: TypeOption[]; flows: FlowOption[]; projects: ProjectOption[] }>("/api/admin/flow-assignments");
    if (!result.ok) return setError(result.message);
    setAssignments(result.data.assignments);
    setTypes(result.data.documentTypes);
    setFlows(result.data.flows);
    setProjects(result.data.projects);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedType = types.find((type) => type.id === form.documentTypeId);

  async function run(action: Promise<{ ok: boolean; message?: string }>, done: string, after?: () => void) {
    setError(null);
    setNotice(null);
    const result = await action;
    if (!result.ok) return setError(result.message ?? "Something went wrong.");
    setNotice(done);
    after?.();
    await load();
  }

  function specificity(row: Assignment): string {
    if (row.project && row.documentSubtype) return "1 · Project + sub type";
    if (row.project) return "2 · Project + type";
    if (row.documentSubtype) return "3 · Sub type (all projects)";
    return "4 · Type (all projects)";
  }

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title="New flow assignment" subtitle="Leave sub type or project empty to cover all of them. Choose “No approval” for documents that need none.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label="Document type">
            <select value={form.documentTypeId} onChange={(e) => setForm({ ...form, documentTypeId: e.target.value, documentSubtypeId: "" })} className={inputClass}>
              <option value="">Select a type</option>
              {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </Field>
          <Field label="Sub type">
            <select value={form.documentSubtypeId} onChange={(e) => setForm({ ...form, documentSubtypeId: e.target.value })} className={inputClass} disabled={!selectedType || selectedType.subtypes.length === 0}>
              <option value="">All sub types</option>
              {selectedType?.subtypes.map((subtype) => <option key={subtype.id} value={subtype.id}>{subtype.name}</option>)}
            </select>
          </Field>
          <Field label="Project">
            <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className={inputClass}>
              <option value="">All projects</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.code} - {project.name}</option>)}
            </select>
          </Field>
          <Field label="Approval flow">
            <select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })} className={inputClass}>
              <option value="">Select a flow</option>
              <option value={AUTO}>No approval (auto-approve)</option>
              {flows.map((flow) => <option key={flow.id} value={flow.id}>{flow.code} · {flow.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <button
            type="button"
            className={primaryButton}
            disabled={!form.documentTypeId || !form.templateId}
            onClick={() =>
              run(
                callApi("/api/admin/flow-assignments", "POST", {
                  documentTypeId: form.documentTypeId,
                  documentSubtypeId: form.documentSubtypeId || null,
                  projectId: form.projectId || null,
                  templateId: form.templateId === AUTO ? null : form.templateId,
                }),
                "Flow assignment saved.",
                () => setForm({ documentTypeId: "", documentSubtypeId: "", projectId: "", templateId: "" }),
              )
            }
          >
            Save assignment
          </button>
        </div>
      </Card>

      <Card title="Flow assignments">
        {assignments.length === 0 ? <Empty>No assignments yet. Until you add some, every uploaded document is approved automatically.</Empty> : null}
        <div className="overflow-x-auto">
          {assignments.length > 0 ? (
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Document type</th>
                  <th className="px-3 py-2 font-semibold">Sub type</th>
                  <th className="px-3 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Specificity</th>
                  <th className="px-3 py-2 font-semibold">Flow</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {assignments.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-medium text-slate-900">{row.documentType.name}</td>
                    <td className="px-3 py-3 text-slate-600">{row.documentSubtype?.name ?? "All"}</td>
                    <td className="px-3 py-3 text-slate-600">{row.project ? `${row.project.code} - ${row.project.name}` : "All"}</td>
                    <td className="px-3 py-3"><Pill>{specificity(row)}</Pill></td>
                    <td className="px-3 py-3">
                      <select
                        value={row.template?.id ?? AUTO}
                        onChange={(e) => run(callApi("/api/admin/flow-assignments", "PATCH", { id: row.id, templateId: e.target.value === AUTO ? null : e.target.value }), "Flow assignment updated.")}
                        className={`${inputClass} w-64`}
                      >
                        <option value={AUTO}>No approval (auto-approve)</option>
                        {flows.map((flow) => <option key={flow.id} value={flow.id}>{flow.code} · {flow.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button type="button" className={dangerButton} onClick={() => window.confirm("Delete this assignment?") && run(callApi("/api/admin/flow-assignments", "DELETE", { id: row.id }), "Flow assignment deleted.")}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
