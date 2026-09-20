"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";

type Role = "CLERK" | "APPROVER_1" | "APPROVER_2" | "APPROVER_3" | "ADMIN" | "ERR_USER";
type Location = "AVR" | "AVK" | "KUWAIT";
type DocumentType = "COMPARISON" | "MATERIAL_REQUISITION";

type WorkflowApprover = {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleAssignments: Role[];
};

type WorkflowStepDraft = {
  id?: string;
  stepNumber: number;
  role: Role;
  approverUserId: string;
};

type WorkflowTemplate = {
  id: string;
  name: string;
  location: Location | null;
  documentType: DocumentType;
  documentSubtype: string | null;
  projectName: string | null;
  isActive: boolean;
  createdAt: string;
  steps: WorkflowStepDraft[];
};

const roleOptions: Array<{ value: Role; label: string }> = [
  { value: "APPROVER_1", label: "PMV Engineer" },
  { value: "APPROVER_2", label: "Workshop Manager" },
  { value: "APPROVER_3", label: "PMV Manager" },
  { value: "ADMIN", label: "Admin" },
  { value: "CLERK", label: "Clerk" },
];

const locationOptions: Array<{ value: Location; label: string }> = [
  { value: "AVR", label: "AVR" },
  { value: "AVK", label: "AVK" },
  { value: "KUWAIT", label: "KUWAIT" },
];

const emptyForm = {
  name: "",
  location: "KUWAIT" as Location,
  documentType: "COMPARISON" as DocumentType,
  documentSubtype: "",
  projectName: "",
  isActive: true,
  steps: [{ stepNumber: 1, role: "APPROVER_1" as Role, approverUserId: "" }],
};

export default function AdminWorkflowManagement() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [approvers, setApprovers] = useState<WorkflowApprover[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await fetch("/api/admin/workflow-templates", { cache: "no-store" });
        const rawText = await response.text();
        if (!rawText) {
          throw new Error("The server returned an empty response while loading workflow templates.");
        }

        let result: { templates?: WorkflowTemplate[]; approvers?: WorkflowApprover[]; message?: string };
        try {
          result = JSON.parse(rawText) as { templates?: WorkflowTemplate[]; approvers?: WorkflowApprover[]; message?: string };
        } catch {
          throw new Error("The workflow template response was invalid.");
        }

        if (!response.ok) throw new Error(result.message || "Unable to load workflow templates.");
        setTemplates(result.templates ?? []);
        setApprovers(result.approvers ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load workflow templates.");
      }
    };

    void loadData();
  }, []);

  const approverOptionsForStep = useMemo(() => {
    return approvers.filter((approver) => {
      if (approver.role === form.steps[0]?.role) return true;
      const assignments = approver.roleAssignments ?? [];
      return assignments.includes(form.steps[0]?.role ?? "APPROVER_1");
    });
  }, [approvers, form.steps]);

  function updateForm<T extends keyof typeof form>(field: T, value: (typeof form)[T]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateStep(index: number, field: "role" | "approverUserId", value: string) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => {
        if (stepIndex !== index) return step;
        if (field === "role") {
          return { ...step, role: value as Role, approverUserId: "" };
        }
        return { ...step, approverUserId: value };
      }),
    }));
  }

  function addStep() {
    setForm((current) => ({
      ...current,
      steps: [
        ...current.steps,
        { stepNumber: current.steps.length + 1, role: "APPROVER_2", approverUserId: "" },
      ],
    }));
  }

  function removeStep(index: number) {
    setForm((current) => {
      const nextSteps = current.steps.filter((_, stepIndex) => stepIndex !== index);
      if (nextSteps.length === 0) {
        return { ...current, steps: [{ stepNumber: 1, role: "APPROVER_1", approverUserId: "" }] };
      }
      return {
        ...current,
        steps: nextSteps.map((step, stepIndex) => ({ ...step, stepNumber: stepIndex + 1 })),
      };
    });
  }

  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/workflow-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify({
          name: form.name,
          location: form.location,
          documentType: form.documentType,
          documentSubtype: form.documentSubtype || null,
          projectName: form.projectName || null,
          isActive: form.isActive,
          steps: form.steps.map((step) => ({
            stepNumber: step.stepNumber,
            role: step.role,
            approverUserId: step.approverUserId,
          })),
        }),
      });

      const rawText = await response.text();
      if (!rawText) {
        throw new Error("The server returned an empty response while saving the workflow template.");
      }

      let result: { template?: WorkflowTemplate; message?: string };
      try {
        result = JSON.parse(rawText) as { template?: WorkflowTemplate; message?: string };
      } catch {
        throw new Error("The workflow template save response was invalid.");
      }

      if (!response.ok || !result.template) {
        throw new Error(result.message || "Unable to save workflow template.");
      }

      setTemplates((current) => [result.template!, ...current]);
      setForm(emptyForm);
      setMessage("Workflow template saved.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save workflow template.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(id: string) {
    const confirmed = window.confirm("Delete this workflow template?");
    if (!confirmed) return;

    try {
      const response = await fetch("/api/admin/workflow-templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-csrf-token": getCsrfTokenFromBrowser() },
        body: JSON.stringify({ id }),
      });
      const rawText = await response.text();
      if (!rawText) {
        throw new Error("The server returned an empty response while deleting the workflow template.");
      }

      let result: { message?: string };
      try {
        result = JSON.parse(rawText) as { message?: string };
      } catch {
        throw new Error("The workflow template delete response was invalid.");
      }

      if (!response.ok) throw new Error(result.message || "Unable to delete workflow template.");
      setTemplates((current) => current.filter((template) => template.id !== id));
      setMessage(result.message || "Workflow template deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete workflow template.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-900">Add Workflow Template</h2>
          <p className="mt-1 text-sm text-slate-500">Set a document approval chain and match it by location, subtype, or project.</p>
        </div>

        <form onSubmit={submitForm} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Template name
              <input
                required
                value={form.name}
                onChange={(event) => updateForm("name", event.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-500"
              />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Location
              <select
                value={form.location}
                onChange={(event) => updateForm("location", event.target.value as Location)}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-slate-500"
              >
                {locationOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Document type
              <select
                value={form.documentType}
                onChange={(event) => updateForm("documentType", event.target.value as DocumentType)}
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-slate-500"
              >
                <option value="COMPARISON">Comparison</option>
                <option value="MATERIAL_REQUISITION">Material Requisition</option>
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Subtype
              <input
                value={form.documentSubtype}
                onChange={(event) => updateForm("documentSubtype", event.target.value)}
                placeholder="e.g. CASH, CREDIT, SPARE_PARTS"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-500"
              />
            </label>

            <label className="text-sm font-medium text-slate-700 md:col-span-2">
              Project name (optional)
              <input
                value={form.projectName}
                onChange={(event) => updateForm("projectName", event.target.value)}
                placeholder="Optional project override"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-500"
              />
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-800">Approval steps</h3>
              <button type="button" onClick={addStep} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">
                <Plus className="h-3.5 w-3.5" /> Add step
              </button>
            </div>

            <div className="space-y-3">
              {form.steps.map((step, index) => {
                const possibleApprovers = approvers.filter((approver) => {
                  if (approver.role === step.role) return true;
                  return (approver.roleAssignments ?? []).includes(step.role);
                });

                return (
                  <div key={index} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[80px_1fr_1.2fr_auto]">
                    <div className="text-sm font-medium text-slate-700 pt-2">Step {index + 1}</div>
                    <select
                      value={step.role}
                      onChange={(event) => updateStep(index, "role", event.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <select
                      value={step.approverUserId}
                      onChange={(event) => updateStep(index, "approverUserId", event.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      <option value="">Select approver</option>
                      {possibleApprovers.map((approver) => (
                        <option key={approver.id} value={approver.id}>{approver.name} ({approver.email})</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => removeStep(index)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-2 text-rose-700 hover:bg-rose-100" title="Remove step">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.isActive} onChange={(event) => updateForm("isActive", event.target.checked)} />
              Active template
            </label>
          </div>

          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "Saving..." : "Save template"}
            </button>
          </div>
        </form>

        {error ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Saved Templates</h2>
        </div>

        <div className="divide-y divide-slate-100">
          {templates.length === 0 ? (
            <div className="px-5 py-8 text-sm text-slate-500">No workflow templates yet.</div>
          ) : (
            templates.map((template) => (
              <div key={template.id} className="px-5 py-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{template.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${template.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {template.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {template.location ?? "Any location"} • {template.documentType} • {template.documentSubtype || "Any subtype"} • {template.projectName || "Any project"}
                    </p>
                  </div>
                  <button type="button" onClick={() => void deleteTemplate(template.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {template.steps.map((step) => (
                    <span key={`${template.id}-${step.stepNumber}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                      {step.stepNumber}. {step.role}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
