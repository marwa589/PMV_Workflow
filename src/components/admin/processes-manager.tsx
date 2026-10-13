"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type TypeOption = { id: string; code: string; name: string; subtypes: Array<{ id: string; code: string; name: string }> };
type ProcessRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { instances: number };
  steps: Array<{ id: string; stepNumber: number; name: string; documentTypeId: string; documentSubtypeId: string | null; documentType: { name: string }; documentSubtype: { name: string } | null }>;
};
type DraftStep = { name: string; documentTypeId: string; documentSubtypeId: string };

const MAX_STEPS = 10;
const blankStep = (): DraftStep => ({ name: "", documentTypeId: "", documentSubtypeId: "" });

/**
 * Designs a process: an ordered list of steps (up to 10), each asking for one document of a type, or of a
 * specific sub type. Each step finishes when its document is uploaded and fully approved.
 */
export default function ProcessesManager() {
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [draft, setDraft] = useState({ id: null as string | null, name: "", description: "", locked: false, steps: [blankStep()] as DraftStep[] });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ processes: ProcessRow[]; documentTypes: TypeOption[] }>("/api/admin/processes");
    if (!result.ok) return setError(result.message);
    setProcesses(result.data.processes);
    setTypes(result.data.documentTypes);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    setDraft({ id: null, name: "", description: "", locked: false, steps: [blankStep()] });
  }

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setDraft((current) => ({ ...current, steps: current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) }));
  }

  async function save() {
    setError(null);
    setNotice(null);
    const base = { name: draft.name, description: draft.description };
    const steps = draft.steps.map((step) => ({ name: step.name, documentTypeId: step.documentTypeId, documentSubtypeId: step.documentSubtypeId || null }));
    const result = draft.id
      ? await callApi("/api/admin/processes", "PATCH", { id: draft.id, ...base, ...(draft.locked ? {} : { steps }) })
      : await callApi("/api/admin/processes", "POST", { ...base, steps });
    if (!result.ok) return setError(result.message);
    setNotice(draft.id ? "Process updated." : "Process created.");
    reset();
    await load();
  }

  async function toggle(process: ProcessRow) {
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/processes", "PATCH", { id: process.id, name: process.name, description: process.description ?? "", isActive: !process.isActive });
    if (!result.ok) return setError(result.message);
    await load();
  }

  async function remove(process: ProcessRow) {
    if (!window.confirm(`Delete process ${process.name}?`)) return;
    setError(null);
    setNotice(null);
    const result = await callApi("/api/admin/processes", "DELETE", { id: process.id });
    if (!result.ok) return setError(result.message);
    setNotice("Process deleted.");
    await load();
  }

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card title={draft.id ? "Edit process" : "New process"} subtitle="For example: Comp Sheet, then Material Req, then Purchase Order.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Name"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} /></Field>
          <Field label="Description"><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={inputClass} /></Field>
        </div>

        {draft.locked ? <p className="mt-4 text-sm text-amber-700">This process already has runs, so its steps are fixed. You can still change the name and description.</p> : null}

        <div className="mt-4 space-y-3">
          {draft.steps.map((step, index) => {
            const type = types.find((candidate) => candidate.id === step.documentTypeId);
            return (
              <div key={index} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[auto,1fr,1fr,1fr,auto]">
                <Pill>Step {index + 1}</Pill>
                <Field label="Step name"><input disabled={draft.locked} value={step.name} onChange={(e) => updateStep(index, { name: e.target.value })} className={inputClass} placeholder="e.g. Comp sheet" /></Field>
                <Field label="Document type">
                  <select disabled={draft.locked} value={step.documentTypeId} onChange={(e) => updateStep(index, { documentTypeId: e.target.value, documentSubtypeId: "" })} className={inputClass}>
                    <option value="">Select a type</option>
                    {types.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </Field>
                <Field label="Sub type">
                  <select disabled={draft.locked || !type || type.subtypes.length === 0} value={step.documentSubtypeId} onChange={(e) => updateStep(index, { documentSubtypeId: e.target.value })} className={inputClass}>
                    <option value="">Any sub type</option>
                    {type?.subtypes.map((subtype) => <option key={subtype.id} value={subtype.id}>{subtype.name}</option>)}
                  </select>
                </Field>
                {!draft.locked && draft.steps.length > 1 ? (
                  <button type="button" className={dangerButton} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}>Remove</button>
                ) : <span />}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!draft.locked ? <button type="button" className={secondaryButton} disabled={draft.steps.length >= MAX_STEPS} onClick={() => setDraft({ ...draft, steps: [...draft.steps, blankStep()] })}>Add step</button> : null}
          <button type="button" className={primaryButton} onClick={save}>{draft.id ? "Save process" : "Create process"}</button>
          {draft.id ? <button type="button" className={secondaryButton} onClick={reset}>Cancel</button> : null}
        </div>
      </Card>

      <Card title="Processes">
        {processes.length === 0 ? <Empty>No processes yet.</Empty> : null}
        <div className="space-y-3">
          {processes.map((process) => (
            <div key={process.id} className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold text-slate-900">{process.name}</span>
                  <span className="text-xs text-slate-500">{process._count.instances} run(s)</span>
                  <Pill tone={process.isActive ? "green" : "amber"}>{process.isActive ? "Active" : "Inactive"}</Pill>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={secondaryButton} onClick={() => { setDraft({ id: process.id, name: process.name, description: process.description ?? "", locked: process._count.instances > 0, steps: process.steps.map((step) => ({ name: step.name, documentTypeId: step.documentTypeId, documentSubtypeId: step.documentSubtypeId ?? "" })) }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
                  <button type="button" className={secondaryButton} onClick={() => toggle(process)}>{process.isActive ? "Deactivate" : "Activate"}</button>
                  <button type="button" className={dangerButton} onClick={() => remove(process)}>Delete</button>
                </div>
              </div>
              {process.description ? <p className="mt-1 text-sm text-slate-600">{process.description}</p> : null}
              <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-slate-700">
                {process.steps.map((step) => (
                  <li key={step.id}>{step.name} <span className="text-slate-500">· {step.documentType.name}{step.documentSubtype ? ` - ${step.documentSubtype.name}` : ""}</span></li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
