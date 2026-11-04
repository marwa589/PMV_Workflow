"use client";

import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type Item = { id: string; name: string; isActive: boolean };
type User = { id: string; name: string; email: string; userTypeId: string };
type UserType = { id: string; name: string };
type Project = { id: string; code: string; name: string };
type ApproverRow = { id: string; approverType: string; userId: string | null; userTypeId: string | null; user?: { name: string } | null; userType?: { name: string } | null };
type Workflow = { id: string; name: string; description: string | null; isActive: boolean; _count: { assignments: number }; levels: Array<{ id: string; levelNumber: number; name: string; approvers: ApproverRow[] }> };
type Assignment = { id: string; project: Project; item: { id: string; name: string }; workflow: { id: string; name: string } };
type Approver = { type: "USER" | "USER_TYPE"; userId: string; userTypeId: string };
type LevelForm = { name: string; approvers: Approver[] };

const blankApprover = (): Approver => ({ type: "USER_TYPE", userId: "", userTypeId: "" });
const blankLevels = (): LevelForm[] => [{ name: "Level 1", approvers: [blankApprover()] }];
const approverValid = (a: Approver) => (a.type === "USER" ? Boolean(a.userId) : Boolean(a.userTypeId));
const toApprover = (a: ApproverRow): Approver => ({ type: a.approverType === "USER" ? "USER" : "USER_TYPE", userId: a.userId ?? "", userTypeId: a.userTypeId ?? "" });
const names = (approvers: ApproverRow[]) => approvers.map((a) => a.user?.name ?? a.userType?.name ?? "Unknown").join(", ");

/** Why a workflow can't be assigned yet, or null when it is complete. */
function incompleteReason(workflow: Workflow): string | null {
  const submit = workflow.levels.find((l) => l.levelNumber === 0);
  if (!submit || submit.approvers.length === 0) return "No submitters";
  if (!workflow.levels.some((l) => l.levelNumber > 0)) return "No follow-up levels";
  return null;
}

function ApproverEditor({ approvers, users, userTypes, onChange }: { approvers: Approver[]; users: User[]; userTypes: UserType[]; onChange: (next: Approver[]) => void }) {
  const update = (index: number, patch: Partial<Approver>) => onChange(approvers.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  return (
    <div className="space-y-2">
      {approvers.map((approver, index) => (
        <div key={index} className="grid grid-cols-1 items-end gap-2 md:grid-cols-[150px_1fr_auto]">
          <Field label="Assignee type">
            <select value={approver.type} onChange={(e) => update(index, { type: e.target.value as Approver["type"], userId: "", userTypeId: "" })} className={inputClass}>
              <option value="USER_TYPE">User type</option>
              <option value="USER">Named user</option>
            </select>
          </Field>
          {approver.type === "USER" ? (
            <Field label="User"><select value={approver.userId} onChange={(e) => update(index, { userId: e.target.value })} className={inputClass}><option value="">Select user</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select></Field>
          ) : (
            <Field label="User type"><select value={approver.userTypeId} onChange={(e) => update(index, { userTypeId: e.target.value })} className={inputClass}><option value="">Select user type</option>{userTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          )}
          <button type="button" className={secondaryButton} disabled={approvers.length === 1} onClick={() => onChange(approvers.filter((_, i) => i !== index))}>Remove</button>
        </div>
      ))}
      <button type="button" className={secondaryButton} onClick={() => onChange([...approvers, blankApprover()])}>Add another</button>
    </div>
  );
}

function CheckList({ options, selected, onChange, empty }: { options: Array<{ id: string; label: string }>; selected: string[]; onChange: (next: string[]) => void; empty: string }) {
  if (options.length === 0) return <p className="text-xs text-slate-500">{empty}</p>;
  const all = selected.length === options.length;
  return (
    <div className="rounded-lg border border-slate-300 bg-white">
      <label className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={all} onChange={() => onChange(all ? [] : options.map((o) => o.id))} />Select all</label>
      <div className="max-h-44 overflow-y-auto">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-800">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id))} />{o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function MaintenanceManager() {
  const [items, setItems] = useState<Item[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [userTypes, setUserTypes] = useState<UserType[]>([]);
  const [itemName, setItemName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [submitters, setSubmitters] = useState<Approver[]>([blankApprover()]);
  const [levels, setLevels] = useState<LevelForm[]>(blankLevels());

  const [assignProjects, setAssignProjects] = useState<string[]>([]);
  const [assignItems, setAssignItems] = useState<string[]>([]);
  const [assignWorkflow, setAssignWorkflow] = useState("");

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await callApi<{ items: Item[]; workflows: Workflow[]; assignments: Assignment[]; projects: Project[]; users: User[]; userTypes: UserType[] }>("/api/admin/maintenance");
    if (!result.ok) { setError(result.message || "Unable to load maintenance setup."); return; }
    setItems(result.data.items); setWorkflows(result.data.workflows); setAssignments(result.data.assignments);
    setProjects(result.data.projects); setUsers(result.data.users); setUserTypes(result.data.userTypes);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs a request, shows its result, reloads, and tells the caller whether it worked. */
  async function run(action: Promise<{ ok: boolean; message?: string }>, success: string): Promise<boolean> {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await action;
      if (!result.ok) throw new Error(result.message || "Request failed.");
      setNotice(success);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error.");
      return false;
    } finally { setBusy(false); }
  }

  function resetWorkflowForm() {
    setEditId(null); setWorkflowName(""); setWorkflowDescription(""); setSubmitters([blankApprover()]); setLevels(blankLevels());
  }

  function startEdit(workflow: Workflow) {
    setEditId(workflow.id); setWorkflowName(workflow.name); setWorkflowDescription(workflow.description ?? "");
    const submit = workflow.levels.find((l) => l.levelNumber === 0);
    setSubmitters(submit && submit.approvers.length ? submit.approvers.map(toApprover) : [blankApprover()]);
    const follow = workflow.levels.filter((l) => l.levelNumber > 0).map((l) => ({ name: l.name, approvers: l.approvers.map(toApprover) }));
    setLevels(follow.length ? follow : blankLevels());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const workflowPayload = () => ({ name: workflowName, description: workflowDescription, submitters, levels });
  const workflowFormValid = workflowName.trim() && submitters.length > 0 && submitters.every(approverValid) && levels.length > 0 && levels.every((l) => l.approvers.length > 0 && l.approvers.every(approverValid));
  const assignableWorkflows = workflows.filter((w) => w.isActive && !incompleteReason(w));
  const activeItems = items.filter((i) => i.isActive);

  return <div className="space-y-6">
    {error ? <Banner kind="error">{error}</Banner> : null}{notice ? <Banner kind="success">{notice}</Banner> : null}

    <Card title="Maintenance items" subtitle="One item list shared by all projects (air conditioner, light bulb, …). Only administrators can add items. Deactivate an item to stop new tickets while keeping its history.">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void run(callApi("/api/admin/maintenance", "POST", { action: "item", name: itemName }), "Maintenance item added.").then((ok) => { if (ok) setItemName(""); }); }}>
        <Field label="New item"><input value={itemName} onChange={(e) => setItemName(e.target.value)} className={inputClass} placeholder="Air conditioner" /></Field>
        <button disabled={busy || !itemName.trim()} className={primaryButton}>Add item</button>
      </form>
      <div className="mt-4 space-y-2">
        {items.length ? items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {renameId === item.id ? (
              <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className={`${inputClass} max-w-xs`} autoFocus />
            ) : (
              <span className="font-medium">{item.name}{!item.isActive ? <span className="ml-2"><Pill tone="amber">Inactive</Pill></span> : null}</span>
            )}
            <div className="flex gap-2">
              {renameId === item.id ? (
                <>
                  <button className={primaryButton} disabled={busy || !renameValue.trim()} onClick={() => void run(callApi("/api/admin/maintenance", "PATCH", { action: "item", id: item.id, name: renameValue }), "Item renamed.").then((ok) => { if (ok) setRenameId(null); })}>Save</button>
                  <button className={secondaryButton} onClick={() => setRenameId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <button className={secondaryButton} disabled={busy} onClick={() => { setRenameId(item.id); setRenameValue(item.name); }}>Rename</button>
                  <button className={secondaryButton} disabled={busy} onClick={() => void run(callApi("/api/admin/maintenance", "PATCH", { action: "item", id: item.id, name: item.name, isActive: !item.isActive }), "Item updated.")}>{item.isActive ? "Deactivate" : "Activate"}</button>
                </>
              )}
            </div>
          </div>
        )) : <Empty>No maintenance items configured.</Empty>}
      </div>
    </Card>

    <Card
      title={editId ? "Edit maintenance workflow" : "Create maintenance workflow"}
      subtitle="Works like an approval flow: first, who can submit a ticket; then the follow-up levels in order. Any one person on a level can complete it. A user type only counts for people of that type who are also assigned to the ticket's project."
      actions={editId ? <button type="button" className={secondaryButton} onClick={resetWorkflowForm}>Cancel editing</button> : undefined}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Workflow name"><input value={workflowName} onChange={(e) => setWorkflowName(e.target.value)} className={inputClass} placeholder="Standard maintenance" /></Field>
        <Field label="Description"><input value={workflowDescription} onChange={(e) => setWorkflowDescription(e.target.value)} className={inputClass} placeholder="Optional" /></Field>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="mb-3 font-semibold text-slate-900">Who can submit a ticket</p>
        <ApproverEditor approvers={submitters} users={users} userTypes={userTypes} onChange={setSubmitters} />
      </div>

      <div className="mt-3 space-y-3">
        {levels.map((level, levelIndex) => (
          <div key={levelIndex} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold text-slate-900">Follow-up level {levelIndex + 1}</span>
              <button type="button" className="text-xs font-medium text-rose-700 disabled:opacity-40" disabled={levels.length === 1} onClick={() => setLevels((current) => current.filter((_, i) => i !== levelIndex))}>Remove level</button>
            </div>
            <Field label="Level name"><input value={level.name} onChange={(e) => setLevels((current) => current.map((l, i) => (i === levelIndex ? { ...l, name: e.target.value } : l)))} className={inputClass} placeholder={`Level ${levelIndex + 1}`} /></Field>
            <div className="mt-3"><ApproverEditor approvers={level.approvers} users={users} userTypes={userTypes} onChange={(next) => setLevels((current) => current.map((l, i) => (i === levelIndex ? { ...l, approvers: next } : l)))} /></div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} disabled={levels.length >= 10} onClick={() => setLevels((current) => [...current, { name: `Level ${current.length + 1}`, approvers: [blankApprover()] }])}>Add level</button>
        <button type="button" className={primaryButton} disabled={busy || !workflowFormValid}
          onClick={() => void run(
            editId ? callApi("/api/admin/maintenance", "PATCH", { action: "workflow", id: editId, ...workflowPayload() }) : callApi("/api/admin/maintenance", "POST", { action: "workflow", ...workflowPayload() }),
            editId ? "Workflow updated. Tickets already submitted keep the levels they were created with." : "Maintenance workflow created.",
          ).then((ok) => { if (ok) resetWorkflowForm(); })}>
          {editId ? "Save changes" : "Create workflow"}
        </button>
      </div>
    </Card>

    <Card title="Assign workflow to projects and items" subtitle="A ticket can only be submitted for a project + item combination that has a workflow. Choose several projects and items to assign them all at once; existing assignments for those combinations are replaced.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Projects"><CheckList options={projects.map((p) => ({ id: p.id, label: `${p.code} - ${p.name}` }))} selected={assignProjects} onChange={setAssignProjects} empty="No active projects." /></Field>
        <Field label="Items"><CheckList options={activeItems.map((i) => ({ id: i.id, label: i.name }))} selected={assignItems} onChange={setAssignItems} empty="Add an item first." /></Field>
        <Field label="Workflow">
          <select value={assignWorkflow} onChange={(e) => setAssignWorkflow(e.target.value)} className={inputClass}>
            <option value="">Select workflow</option>
            {assignableWorkflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {workflows.some((w) => w.isActive && incompleteReason(w)) ? <span className="mt-1 block text-xs text-amber-700">Incomplete workflows are hidden here. Edit them below.</span> : null}
        </Field>
      </div>
      <button className={`${primaryButton} mt-3`} disabled={busy || assignProjects.length === 0 || assignItems.length === 0 || !assignWorkflow}
        onClick={() => void run(callApi("/api/admin/maintenance", "POST", { action: "assignment", projectIds: assignProjects, itemIds: assignItems, workflowId: assignWorkflow }), `Saved ${assignProjects.length * assignItems.length} assignment(s).`).then((ok) => { if (ok) { setAssignProjects([]); setAssignItems([]); } })}>
        Save assignment{assignProjects.length * assignItems.length > 1 ? "s" : ""}
      </button>
      <div className="mt-4 space-y-2">
        {assignments.length ? assignments.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span><span className="font-medium">{a.project.code} - {a.project.name}</span><span className="text-slate-500"> · {a.item.name} → {a.workflow.name}</span></span>
            <button className={dangerButton} disabled={busy} onClick={() => window.confirm("Remove this assignment? New tickets can no longer be submitted for it. Existing tickets are not affected.") && void run(callApi("/api/admin/maintenance", "DELETE", { action: "assignment", id: a.id }), "Assignment removed.")}>Remove</button>
          </div>
        )) : <Empty>No project/item workflow assignments yet.</Empty>}
      </div>
    </Card>

    <Card title="Configured workflows">
      <div className="space-y-3">
        {workflows.length ? workflows.map((workflow) => {
          const problem = incompleteReason(workflow);
          const submit = workflow.levels.find((l) => l.levelNumber === 0);
          return (
            <div key={workflow.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{workflow.name} {!workflow.isActive ? <Pill tone="amber">Inactive</Pill> : null} {problem ? <Pill tone="amber">Incomplete: {problem}</Pill> : null}</p>
                  <p className="text-xs text-slate-500">{workflow.levels.filter((l) => l.levelNumber > 0).length} follow-up level(s) · {workflow._count.assignments} assignment(s){workflow.description ? ` · ${workflow.description}` : ""}</p>
                </div>
                <div className="flex gap-2">
                  <button className={secondaryButton} disabled={busy} onClick={() => startEdit(workflow)}>Edit</button>
                  <button className={secondaryButton} disabled={busy} onClick={() => void run(callApi("/api/admin/maintenance", "PATCH", { action: "workflow", id: workflow.id, isActive: !workflow.isActive }), "Workflow updated.")}>{workflow.isActive ? "Deactivate" : "Activate"}</button>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                <p className="text-xs text-slate-600"><b>Can submit:</b> {submit && submit.approvers.length ? names(submit.approvers) : "nobody yet"}</p>
                {workflow.levels.filter((l) => l.levelNumber > 0).map((level) => <p key={level.id} className="text-xs text-slate-600"><b>L{level.levelNumber} · {level.name}:</b> {names(level.approvers)}</p>)}
              </div>
            </div>
          );
        }) : <Empty>No maintenance workflows configured.</Empty>}
      </div>
    </Card>
  </div>;
}
