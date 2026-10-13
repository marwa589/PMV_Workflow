"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type UserOption = { id: string; name: string; email: string; userType: { code: string; name: string } };
type TypeOption = { id: string; code: string; name: string };
type Entry = { approverType: "USER" | "USER_TYPE"; userId: string | null; userTypeId: string | null; userName?: string | null; userTypeName?: string | null };
type Step = { stepNumber: number; name: string; approvers: Entry[] };
type Flow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  assignmentCount: number;
  steps: Array<{ id: string; stepNumber: number; name: string | null; approvers: Array<Entry & { id: string }> }>;
};

const MAX_LEVEL = 10;

function newDraft() {
  return {
    id: null as string | null,
    code: "",
    name: "",
    description: "",
    isActive: true,
    steps: [
      { stepNumber: 0, name: "Uploader", approvers: [] },
      { stepNumber: 1, name: "", approvers: [] },
    ] as Step[],
  };
}

function entryLabel(entry: Entry, users: UserOption[], types: TypeOption[]): string {
  if (entry.approverType === "USER") return entry.userName ?? users.find((u) => u.id === entry.userId)?.name ?? "User";
  return `Any ${entry.userTypeName ?? types.find((t) => t.id === entry.userTypeId)?.name ?? "user"}`;
}

/**
 * Builds approval flows. Level 0 says who may upload into the flow; levels 1 to 10 are approvals.
 * Each level lists named users and/or user types; any one of them is enough to act (OR).
 */
export default function FlowsManager() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [draft, setDraft] = useState(newDraft());
  const [adding, setAdding] = useState<Record<number, { kind: "USER" | "USER_TYPE"; id: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ flows: Flow[]; users: UserOption[]; userTypes: TypeOption[] }>("/api/admin/flows");
    if (!result.ok) return setError(result.message);
    setFlows(result.data.flows);
    setUsers(result.data.users);
    setTypes(result.data.userTypes);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateStep(stepNumber: number, patch: Partial<Step>) {
    setDraft((current) => ({ ...current, steps: current.steps.map((step) => (step.stepNumber === stepNumber ? { ...step, ...patch } : step)) }));
  }

  function addEntry(stepNumber: number) {
    const choice = adding[stepNumber];
    if (!choice?.id) return;
    const step = draft.steps.find((candidate) => candidate.stepNumber === stepNumber);
    if (!step) return;
    const duplicate = step.approvers.some((entry) => (choice.kind === "USER" ? entry.userId === choice.id : entry.userTypeId === choice.id));
    if (duplicate) return setError("That entry is already on this level.");
    setError(null);
    const entry: Entry =
      choice.kind === "USER"
        ? { approverType: "USER", userId: choice.id, userTypeId: null, userName: users.find((u) => u.id === choice.id)?.name }
        : { approverType: "USER_TYPE", userId: null, userTypeId: choice.id, userTypeName: types.find((t) => t.id === choice.id)?.name };
    updateStep(stepNumber, { approvers: [...step.approvers, entry] });
    setAdding((current) => ({ ...current, [stepNumber]: { kind: choice.kind, id: "" } }));
  }

  function edit(flow: Flow) {
    setDraft({
      id: flow.id,
      code: flow.code,
      name: flow.name,
      description: flow.description ?? "",
      isActive: flow.isActive,
      steps: flow.steps.map((step) => ({
        stepNumber: step.stepNumber,
        name: step.name ?? "",
        approvers: step.approvers.map((entry) => ({ approverType: entry.approverType, userId: entry.userId, userTypeId: entry.userTypeId, userName: entry.userName, userTypeName: entry.userTypeName })),
      })),
    });
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = {
      id: draft.id ?? undefined,
      code: draft.code,
      name: draft.name,
      description: draft.description,
      isActive: draft.isActive,
      steps: draft.steps.map((step) => ({
        stepNumber: step.stepNumber,
        name: step.name,
        approvers: step.approvers.map((entry) => ({ approverType: entry.approverType, userId: entry.userId ?? undefined, userTypeId: entry.userTypeId ?? undefined })),
      })),
    };
    const result = draft.id ? await callApi("/api/admin/flows", "PATCH", payload) : await callApi("/api/admin/flows", "POST", payload);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    setNotice(draft.id ? "Flow updated. Documents already in progress keep the levels they started with." : "Flow created.");
    setDraft(newDraft());
    await load();
  }

  async function remove(flow: Flow) {
    if (!window.confirm(`Delete flow ${flow.code}?`)) return;
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/flows", "DELETE", { id: flow.id });
    if (!result.ok) return setError(result.message);
    setNotice("Flow deleted.");
    await load();
  }

  const lastLevel = draft.steps[draft.steps.length - 1]?.stepNumber ?? 0;

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card
        title={draft.id ? `Edit flow ${draft.code}` : "New approval flow"}
        subtitle="A flow is a chain of levels. Assign it to a document type, sub type or project in Flow Assignments."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Code"><input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} className={inputClass} placeholder="0001" /></Field>
          <Field label="Name"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} /></Field>
          <Field label="Description"><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={inputClass} /></Field>
        </div>

        <div className="mt-5 space-y-4">
          {draft.steps.map((step) => {
            const choice = adding[step.stepNumber] ?? { kind: "USER_TYPE" as const, id: "" };
            return (
              <div key={step.stepNumber} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Pill tone={step.stepNumber === 0 ? "amber" : "slate"}>{step.stepNumber === 0 ? "Level 0 · Uploader" : `Level ${step.stepNumber}`}</Pill>
                    <input
                      value={step.name}
                      onChange={(e) => updateStep(step.stepNumber, { name: e.target.value })}
                      placeholder={step.stepNumber === 0 ? "Who may upload" : "Level name, e.g. PMV Engineer"}
                      className={`${inputClass} w-64`}
                    />
                  </div>
                  {step.stepNumber > 0 && step.stepNumber === lastLevel && draft.steps.length > 2 ? (
                    <button type="button" className={dangerButton} onClick={() => setDraft({ ...draft, steps: draft.steps.slice(0, -1) })}>Remove level</button>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {step.approvers.length === 0 ? <span className="text-xs text-slate-500">Nobody yet. Add at least one user or user type.</span> : null}
                  {step.approvers.map((entry, index) => (
                    <span key={index} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm text-slate-800 ring-1 ring-slate-200">
                      {entryLabel(entry, users, types)}
                      <button type="button" aria-label="Remove" className="text-slate-400 hover:text-rose-600" onClick={() => updateStep(step.stepNumber, { approvers: step.approvers.filter((_, i) => i !== index) })}>×</button>
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <select value={choice.kind} onChange={(e) => setAdding({ ...adding, [step.stepNumber]: { kind: e.target.value as "USER" | "USER_TYPE", id: "" } })} className={`${inputClass} w-44`}>
                    <option value="USER_TYPE">A user type</option>
                    <option value="USER">A named user</option>
                  </select>
                  <select value={choice.id} onChange={(e) => setAdding({ ...adding, [step.stepNumber]: { kind: choice.kind, id: e.target.value } })} className={`${inputClass} w-64`}>
                    <option value="">{choice.kind === "USER" ? "Choose a user" : "Choose a user type"}</option>
                    {choice.kind === "USER"
                      ? users.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.userType.name})</option>)
                      : types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                  </select>
                  <button type="button" className={secondaryButton} onClick={() => addEntry(step.stepNumber)}>Add</button>
                </div>
                {step.stepNumber > 0 ? (
                  <p className="mt-2 text-xs text-slate-500">A user type works only for people of that type who also hold a role assignment covering the document&apos;s project. A named user works anywhere.</p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={lastLevel >= MAX_LEVEL} className={secondaryButton} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { stepNumber: lastLevel + 1, name: "", approvers: [] }] })}>
            Add level {lastLevel + 1}
          </button>
          <button type="button" className={primaryButton} disabled={saving} onClick={save}>{saving ? "Saving..." : draft.id ? "Save flow" : "Create flow"}</button>
          {draft.id ? <button type="button" className={secondaryButton} onClick={() => setDraft(newDraft())}>Cancel</button> : null}
        </div>
      </Card>

      <Card title="Flows">
        {flows.length === 0 ? <Empty>No flows yet.</Empty> : null}
        <div className="space-y-3">
          {flows.map((flow) => (
            <div key={flow.id} className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Pill>{flow.code}</Pill>
                  <span className="font-semibold text-slate-900">{flow.name}</span>
                  <span className="text-xs text-slate-500">used by {flow.assignmentCount} assignment(s)</span>
                  <Pill tone={flow.isActive ? "green" : "amber"}>{flow.isActive ? "Active" : "Inactive"}</Pill>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={secondaryButton} onClick={() => edit(flow)}>Edit</button>
                  <button type="button" className={dangerButton} onClick={() => remove(flow)}>Delete</button>
                </div>
              </div>
              <ol className="mt-3 space-y-1 text-sm text-slate-700">
                {flow.steps.map((step) => (
                  <li key={step.id}>
                    <span className="font-medium text-slate-900">{step.stepNumber === 0 ? "Uploader" : `Level ${step.stepNumber}${step.name ? ` · ${step.name}` : ""}`}:</span>{" "}
                    {step.approvers.map((entry) => entryLabel(entry, users, types)).join(" or ")}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
