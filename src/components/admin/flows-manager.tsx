"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi, callApiWithDeactivationConfirmation } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type UserOption = { id: string; name: string; email: string; userType: { code: string; name: string } };
type TypeOption = { id: string; code: string; name: string };
type EntryKind = "USER" | "USER_TYPE" | "PROJECT_DIRECTOR" | "PROJECT_MANAGER";
type RoleKind = "PROJECT_DIRECTOR" | "PROJECT_MANAGER";
const ROLE_LABEL: Record<RoleKind, string> = { PROJECT_DIRECTOR: "Project Director", PROJECT_MANAGER: "Project Manager" };
const isRole = (kind: EntryKind): kind is RoleKind => kind === "PROJECT_DIRECTOR" || kind === "PROJECT_MANAGER";
type Entry = { approverType: EntryKind; userId: string | null; userTypeId: string | null; userName?: string | null; userTypeName?: string | null };
// A unique track: the person who receives the document, and where it goes after they approve (null = fully approved).
type Track = { name: string; receiverUserId: string; returnLevel: number | null; signatureRequired: boolean };
type Step = { stepNumber: number; name: string; signatureRequired: boolean; approvers: Entry[]; tracks: Track[] };
type Flow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  assignmentCount: number;
  documentCount: number;
  steps: Array<{
    id: string;
    stepNumber: number;
    name: string | null;
    signatureRequired: boolean;
    approvers: Array<Entry & { id: string }>;
    tracks: Array<Track & { id: string; receiverName: string }>;
  }>;
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
      { stepNumber: 0, name: "Uploader", signatureRequired: true, approvers: [], tracks: [] },
      { stepNumber: 1, name: "", signatureRequired: true, approvers: [], tracks: [] },
    ] as Step[],
  };
}

function entryLabel(entry: Entry, users: UserOption[], types: TypeOption[]): string {
  if (isRole(entry.approverType)) return ROLE_LABEL[entry.approverType];
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
  const [adding, setAdding] = useState<Record<number, { kind: EntryKind; id: string }>>({});
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
    if (!choice || (!isRole(choice.kind) && !choice.id)) return;
    const step = draft.steps.find((candidate) => candidate.stepNumber === stepNumber);
    if (!step) return;
    const duplicate = step.approvers.some((entry) =>
      isRole(choice.kind)
        ? entry.approverType === choice.kind
        : choice.kind === "USER"
          ? entry.userId === choice.id
          : entry.userTypeId === choice.id,
    );
    if (duplicate) return setError("That entry is already on this level.");
    setError(null);
    const entry: Entry =
      isRole(choice.kind)
        ? { approverType: choice.kind, userId: null, userTypeId: null }
        : choice.kind === "USER"
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
        signatureRequired: step.signatureRequired,
        approvers: step.approvers.map((entry) => ({ approverType: entry.approverType, userId: entry.userId, userTypeId: entry.userTypeId, userName: entry.userName, userTypeName: entry.userTypeName })),
        tracks: step.tracks.map((track) => ({ name: track.name, receiverUserId: track.receiverUserId, returnLevel: track.returnLevel, signatureRequired: track.signatureRequired })),
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
        signatureRequired: step.signatureRequired,
        approvers: step.approvers.map((entry) => ({ approverType: entry.approverType, userId: entry.userId ?? undefined, userTypeId: entry.userTypeId ?? undefined })),
        tracks: step.tracks,
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

  async function toggleActive(flow: Flow) {
    setError(null);
    setNotice(null);
    const result = flow.isActive
      ? await callApiWithDeactivationConfirmation("/api/admin/flows", { id: flow.id, isActive: false })
      : await callApi("/api/admin/flows", "PATCH", { id: flow.id, isActive: true });
    if ("cancelled" in result && result.cancelled) return;
    if (!result.ok) return setError(result.message);
    setNotice(`Flow ${flow.isActive ? "deactivated" : "activated"}. Documents already in progress keep their existing approval steps.`);
    await load();
  }

  const lastLevel = draft.steps[draft.steps.length - 1]?.stepNumber ?? 0;

  function updateTrack(stepNumber: number, index: number, patch: Partial<Track>) {
    const step = draft.steps.find((candidate) => candidate.stepNumber === stepNumber);
    if (!step) return;
    updateStep(stepNumber, { tracks: step.tracks.map((track, i) => (i === index ? { ...track, ...patch } : track)) });
  }

  // Removing the last level: a track that returned to it now returns to full approval.
  function removeLastLevel() {
    const removed = lastLevel;
    setDraft({
      ...draft,
      steps: draft.steps.slice(0, -1).map((step) => ({ ...step, tracks: step.tracks.map((track) => (track.returnLevel !== null && track.returnLevel >= removed ? { ...track, returnLevel: null } : track)) })),
    });
  }

  const levelLabel = (steps: Array<{ stepNumber: number; name: string | null }>, level: number) => {
    const step = steps.find((candidate) => candidate.stepNumber === level);
    return `Level ${level}${step?.name ? ` · ${step.name}` : ""}`;
  };

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
                    <button type="button" className={dangerButton} onClick={removeLastLevel}>Remove level</button>
                  ) : null}
                </div>

                {step.stepNumber > 0 ? (
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={step.signatureRequired}
                      aria-label={`Signature required at level ${step.stepNumber}`}
                      onClick={() => updateStep(step.stepNumber, { signatureRequired: !step.signatureRequired })}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${step.signatureRequired ? "bg-cyan-600" : "bg-slate-300"}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${step.signatureRequired ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                    <span className="text-sm text-slate-700">Signature required</span>
                    <span className="text-xs text-slate-500">{step.signatureRequired ? "The approver must place a signature to approve." : "The approver can approve without a signature."}</span>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {step.approvers.length === 0 ? <span className="text-xs text-slate-500">Nobody yet. Add at least one user, user type, the Project Director or the Project Manager.</span> : null}
                  {step.approvers.map((entry, index) => (
                    <span key={index} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ring-1 ${isRole(entry.approverType) ? "bg-cyan-50 text-cyan-900 ring-cyan-200" : "bg-white text-slate-800 ring-slate-200"}`}>
                      {entryLabel(entry, users, types)}
                      <button type="button" aria-label="Remove" className="text-slate-400 hover:text-rose-600" onClick={() => updateStep(step.stepNumber, { approvers: step.approvers.filter((_, i) => i !== index) })}>×</button>
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <select value={choice.kind} onChange={(e) => setAdding({ ...adding, [step.stepNumber]: { kind: e.target.value as EntryKind, id: "" } })} className={`${inputClass} w-44`}>
                    <option value="USER_TYPE">A user type</option>
                    <option value="USER">A named user</option>
                    <option value="PROJECT_DIRECTOR">Project Director</option>
                    <option value="PROJECT_MANAGER">Project Manager</option>
                  </select>
                  {isRole(choice.kind) ? (
                    <span className="flex h-10 w-64 items-center rounded-lg border border-dashed border-cyan-300 bg-cyan-50 px-3 text-xs text-cyan-900">
                      The {choice.kind === "PROJECT_DIRECTOR" ? "director" : "manager"} of the document&apos;s project
                    </span>
                  ) : (
                    <select value={choice.id} onChange={(e) => setAdding({ ...adding, [step.stepNumber]: { kind: choice.kind, id: e.target.value } })} className={`${inputClass} w-64`}>
                      <option value="">{choice.kind === "USER" ? "Choose a user" : "Choose a user type"}</option>
                      {choice.kind === "USER"
                        ? users.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.userType.name})</option>)
                        : types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                    </select>
                  )}
                  <button type="button" className={secondaryButton} onClick={() => addEntry(step.stepNumber)}>Add</button>
                </div>
                {step.stepNumber > 0 ? (
                  <p className="mt-2 text-xs text-slate-500">A user type works only for people of that type who also hold a role assignment covering the document&apos;s project. A named user works anywhere. Project Director and Project Manager go to the person set on the document&apos;s project in Projects &amp; Locations.</p>
                ) : null}

                <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Unique tracks</p>
                      <p className="text-xs text-slate-500">
                        {step.stepNumber === 0 ? "The uploader can tick one when uploading" : "Whoever approves this level can tick one when approving"}: the document then goes straight to one person, and from there to the stage you choose.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => updateStep(step.stepNumber, { tracks: [...step.tracks, { name: "", receiverUserId: "", returnLevel: null, signatureRequired: true }] })}
                    >
                      Add unique track
                    </button>
                  </div>
                  {step.tracks.length === 0 ? <p className="mt-2 text-xs text-slate-500">No unique tracks on this level.</p> : null}
                  <div className="mt-3 space-y-3">
                    {step.tracks.map((track, index) => (
                      <div key={index} className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
                        <Field label="Track name (shown as the check box)">
                          <input value={track.name} onChange={(e) => updateTrack(step.stepNumber, index, { name: e.target.value })} className={inputClass} placeholder="Goes to Eng. Marc directly" />
                        </Field>
                        <Field label="Receives the document">
                          <select value={track.receiverUserId} onChange={(e) => updateTrack(step.stepNumber, index, { receiverUserId: e.target.value })} className={inputClass}>
                            <option value="">Choose a user</option>
                            {users.map((user) => <option key={user.id} value={user.id}>{user.name} ({user.userType.name})</option>)}
                          </select>
                        </Field>
                        <Field label="After they approve, goes to">
                          <select
                            value={track.returnLevel === null ? "" : String(track.returnLevel)}
                            onChange={(e) => updateTrack(step.stepNumber, index, { returnLevel: e.target.value === "" ? null : Number(e.target.value) })}
                            className={inputClass}
                          >
                            <option value="">Full approval</option>
                            {draft.steps.filter((later) => later.stepNumber > step.stepNumber).map((later) => (
                              <option key={later.stepNumber} value={later.stepNumber}>{levelLabel(draft.steps, later.stepNumber)}</option>
                            ))}
                          </select>
                        </Field>
                        <div className="flex items-end gap-3">
                          <label className="inline-flex items-center gap-2 pb-2 text-xs text-slate-700">
                            <input type="checkbox" checked={track.signatureRequired} onChange={(e) => updateTrack(step.stepNumber, index, { signatureRequired: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                            Signature required
                          </label>
                          <button type="button" className={dangerButton} onClick={() => updateStep(step.stepNumber, { tracks: step.tracks.filter((_, i) => i !== index) })}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={lastLevel >= MAX_LEVEL} className={secondaryButton} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { stepNumber: lastLevel + 1, name: "", signatureRequired: true, approvers: [], tracks: [] }] })}>
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
                  <span className="text-xs text-slate-500">{flow.documentCount} document(s)</span>
                  <Pill tone={flow.isActive ? "green" : "amber"}>{flow.isActive ? "Active" : "Inactive"}</Pill>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={secondaryButton} onClick={() => edit(flow)}>Edit</button>
                  <button type="button" className={secondaryButton} onClick={() => toggleActive(flow)}>{flow.isActive ? "Deactivate" : "Activate"}</button>
                  <button type="button" className={dangerButton} onClick={() => remove(flow)}>Delete</button>
                </div>
              </div>
              <ol className="mt-3 space-y-1 text-sm text-slate-700">
                {flow.steps.map((step) => (
                  <li key={step.id}>
                    <span className="font-medium text-slate-900">{step.stepNumber === 0 ? "Uploader" : `Level ${step.stepNumber}${step.name ? ` · ${step.name}` : ""}`}:</span>{" "}
                    {step.approvers.map((entry) => entryLabel(entry, users, types)).join(" or ")}
                    {step.stepNumber > 0 && !step.signatureRequired ? <span className="ml-2 text-xs text-amber-700">no signature required</span> : null}
                    {step.tracks.map((track) => (
                      <div key={track.id} className="ml-5 text-xs text-cyan-800">
                        Unique track &quot;{track.name}&quot;: {track.receiverName}, then {track.returnLevel === null ? "full approval" : levelLabel(flow.steps, track.returnLevel)}
                      </div>
                    ))}
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
