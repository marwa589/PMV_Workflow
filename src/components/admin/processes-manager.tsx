"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { callApi, callApiWithDeactivationConfirmation } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type TypeOption = { id: string; code: string; name: string; subtypes: Array<{ id: string; code: string; name: string }> };
type StepRow = {
  id: string;
  stepNumber: number;
  name: string;
  parentStepId: string | null;
  documentTypeId: string;
  documentSubtypeId: string | null;
  documentType: { name: string };
  documentSubtype: { name: string } | null;
};
type ProcessRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  currentVersion: number;
  _count: { instances: number };
  steps: StepRow[];
};
type DraftNode = { key: string; parentKey: string | null; name: string; documentTypeId: string; documentSubtypeId: string };

const MAX_NODES = 100;

/** A process built the new way has exactly one root; the old linear processes have several and cannot run. */
const isTree = (process: ProcessRow) => process.steps.filter((step) => step.parentStepId === null).length === 1;

/**
 * Designs a process as a tree of documents. The root is the document whose upload starts a run automatically.
 * Under any document you can add several "next document" choices; each is optional, and whichever one the
 * uploader picks, the run follows that path to its end (a document with no choices ends the path).
 */
export default function ProcessesManager() {
  const keyCounter = useRef(0);
  const newKey = () => `n${Date.now().toString(36)}${keyCounter.current++}`;
  const blankNode = (parentKey: string | null): DraftNode => ({ key: newKey(), parentKey, name: "", documentTypeId: "", documentSubtypeId: "" });

  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [draft, setDraft] = useState<{ id: string | null; name: string; description: string; locked: boolean; hasRuns: boolean; nodes: DraftNode[] }>(() => ({
    id: null,
    name: "",
    description: "",
    locked: false,
    hasRuns: false,
    nodes: [{ key: "root", parentKey: null, name: "", documentTypeId: "", documentSubtypeId: "" }],
  }));
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
    setDraft({ id: null, name: "", description: "", locked: false, hasRuns: false, nodes: [{ key: newKey(), parentKey: null, name: "", documentTypeId: "", documentSubtypeId: "" }] });
  }

  function updateNode(key: string, patch: Partial<DraftNode>) {
    setDraft((current) => ({ ...current, nodes: current.nodes.map((node) => (node.key === key ? { ...node, ...patch } : node)) }));
  }

  function addChild(parentKey: string) {
    setDraft((current) => (current.nodes.length >= MAX_NODES ? current : { ...current, nodes: [...current.nodes, blankNode(parentKey)] }));
  }

  function removeNode(key: string) {
    setDraft((current) => {
      // Removing a document removes everything that follows it.
      const doomed = new Set<string>([key]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const node of current.nodes) {
          if (node.parentKey && doomed.has(node.parentKey) && !doomed.has(node.key)) {
            doomed.add(node.key);
            grew = true;
          }
        }
      }
      return { ...current, nodes: current.nodes.filter((node) => !doomed.has(node.key)) };
    });
  }

  async function save() {
    setError(null);
    setNotice(null);
    const base = { name: draft.name, description: draft.description };
    const steps = draft.nodes.map((node) => ({
      key: node.key,
      parentKey: node.parentKey,
      name: node.name,
      documentTypeId: node.documentTypeId,
      documentSubtypeId: node.documentSubtypeId || null,
    }));
    const result = draft.id
      ? await callApi("/api/admin/processes", "PATCH", { id: draft.id, ...base, steps })
      : await callApi("/api/admin/processes", "POST", { ...base, steps });
    if (!result.ok) return setError(result.message);
    setNotice(draft.id ? "Process updated." : "Process created.");
    reset();
    await load();
  }

  async function toggle(process: ProcessRow) {
    setError(null);
    setNotice(null);
    const result = process.isActive
      ? await callApiWithDeactivationConfirmation("/api/admin/processes", { id: process.id, name: process.name, description: process.description ?? "", isActive: false })
      : await callApi("/api/admin/processes", "PATCH", { id: process.id, name: process.name, description: process.description ?? "", isActive: true });
    if ("cancelled" in result && result.cancelled) return;
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

  function edit(process: ProcessRow) {
    setDraft({
      id: process.id,
      name: process.name,
      description: process.description ?? "",
      locked: false,
      hasRuns: process._count.instances > 0,
      nodes: process.steps.map((step) => ({
        key: step.id,
        parentKey: step.parentStepId,
        name: step.name,
        documentTypeId: step.documentTypeId,
        documentSubtypeId: step.documentSubtypeId ?? "",
      })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** One node of the editor, with its choices nested below it. */
  function renderNode(node: DraftNode, depth: number): ReactNode {
    const type = types.find((candidate) => candidate.id === node.documentTypeId);
    const children = draft.nodes.filter((candidate) => candidate.parentKey === node.key);
    const parent = draft.nodes.find((candidate) => candidate.key === node.parentKey);
    return (
      <div key={node.key} className={depth > 0 ? "ml-5 border-l-2 border-cyan-200 pl-4" : ""}>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Pill tone={depth === 0 ? "green" : "slate"}>
              {depth === 0 ? "Start document (uploading it starts the process)" : `Optional next document after "${parent?.name || "…"}"`}
            </Pill>
            <div className="flex gap-2">
              {!draft.locked ? (
                <button type="button" className={secondaryButton} disabled={draft.nodes.length >= MAX_NODES} onClick={() => addChild(node.key)}>
                  Add next document choice
                </button>
              ) : null}
              {!draft.locked && depth > 0 ? (
                <button type="button" className={dangerButton} onClick={() => removeNode(node.key)}>Remove</button>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Name"><input disabled={draft.locked} value={node.name} onChange={(e) => updateNode(node.key, { name: e.target.value })} className={inputClass} placeholder="e.g. Material requisition" /></Field>
            <Field label="Document type">
              <select disabled={draft.locked} value={node.documentTypeId} onChange={(e) => updateNode(node.key, { documentTypeId: e.target.value, documentSubtypeId: "" })} className={inputClass}>
                <option value="">Select a type</option>
                {types.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </Field>
            <Field label="Sub type">
              <select disabled={draft.locked || !type || type.subtypes.length === 0} value={node.documentSubtypeId} onChange={(e) => updateNode(node.key, { documentSubtypeId: e.target.value })} className={inputClass}>
                <option value="">Any sub type</option>
                {type?.subtypes.map((subtype) => <option key={subtype.id} value={subtype.id}>{subtype.name}</option>)}
              </select>
            </Field>
          </div>
          {children.length === 0 ? <p className="text-xs text-slate-500">No choices after this document: the process ends here once it is approved.</p> : null}
        </div>
        {children.length > 0 ? <div className="mt-3 space-y-3">{children.map((child) => renderNode(child, depth + 1))}</div> : null}
      </div>
    );
  }

  function renderOutline(steps: StepRow[], parentId: string | null): ReactNode {
    const children = steps.filter((step) => step.parentStepId === parentId);
    if (children.length === 0) return null;
    return (
      <ul className={parentId === null ? "mt-2 space-y-1 text-sm text-slate-700" : "ml-5 mt-1 space-y-1 border-l border-slate-200 pl-3"}>
        {children.map((step) => (
          <li key={step.id}>
            {step.name} <span className="text-slate-500">· {step.documentType.name}{step.documentSubtype ? ` - ${step.documentSubtype.name}` : ""}</span>
            {renderOutline(steps, step.id)}
          </li>
        ))}
      </ul>
    );
  }

  const root = draft.nodes.find((node) => node.parentKey === null);

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card
        title={draft.id ? "Edit process" : "New process"}
        subtitle="Uploading the start document begins the process on its own. After each approved document, the uploader chooses one of the optional next documents and the process follows that path to its end."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Name"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} /></Field>
          <Field label="Description"><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={inputClass} /></Field>
        </div>

        {draft.hasRuns ? <p className="mt-4 text-sm text-amber-700">This process already has runs. Saving creates a new version of the tree: runs that already started (finished or still running) keep following the version they started with, and every new upload follows the new one.</p> : null}

        <div className="mt-4">{root ? renderNode(root, 0) : null}</div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={primaryButton} onClick={save}>{draft.id ? "Save process" : "Create process"}</button>
          {draft.id ? <button type="button" className={secondaryButton} onClick={reset}>Cancel</button> : null}
        </div>
      </Card>

      <Card title="Processes">
        {processes.length === 0 ? <Empty>No processes yet.</Empty> : null}
        <div className="space-y-3">
          {processes.map((process) => {
            const tree = isTree(process);
            return (
              <div key={process.id} className="rounded-xl border border-slate-200 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-semibold text-slate-900">{process.name}</span>
                    <span className="text-xs text-slate-500">{process._count.instances} run(s)</span>
                    <Pill tone={process.isActive ? "green" : "amber"}>{process.isActive ? "Active" : "Inactive"}</Pill>
                    {!tree ? <Pill>Old linear process (history only)</Pill> : null}
                  </div>
                  <div className="flex gap-2">
                    {tree ? <button type="button" className={secondaryButton} onClick={() => edit(process)}>Edit</button> : null}
                    {tree ? <button type="button" className={secondaryButton} onClick={() => toggle(process)}>{process.isActive ? "Deactivate" : "Activate"}</button> : null}
                    <button type="button" className={dangerButton} onClick={() => remove(process)}>Delete</button>
                  </div>
                </div>
                {process.description ? <p className="mt-1 text-sm text-slate-600">{process.description}</p> : null}
                {tree ? (
                  renderOutline(process.steps, null)
                ) : (
                  <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-slate-700">
                    {process.steps.map((step) => (
                      <li key={step.id}>{step.name} <span className="text-slate-500">· {step.documentType.name}{step.documentSubtype ? ` - ${step.documentSubtype.name}` : ""}</span></li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
