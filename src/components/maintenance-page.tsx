"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { getCsrfTokenFromBrowser } from "@/lib/csrf";
import { Pager, usePagination } from "@/components/pager";

type Project = { id: string; code: string; name: string };
type Item = { id: string; name: string };
type Ticket = {
  id: string; ticketNumber: string; requestType: string; units: number; phoneNumber: string; description: string; status: string; currentLevel: number; createdAt: string; closedAt: string | null;
  project: Project; item: Item; requester: { id: string; name: string; email: string };
  steps: Array<{ id: string; levelNumber: number; name: string; status: string; actedAt: string | null; actedBy: { name: string } | null; approvers: Array<{ approverType: string; user: { name: string } | null; userType: { name: string } | null }> }>;
  attachments: Array<{ id: string; originalName: string; mimeType: string; fileSize: number; createdAt: string }>;
  canAct: boolean; isRequester: boolean;
};
type Tab = "action" | "mine" | "all";

const FILE_ACCEPT = ".pdf,.docx,.xlsx,.jpg,.jpeg,.png";
const fieldClass = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

export default function MaintenancePage() {
  const [loaded, setLoaded] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [pairs, setPairs] = useState<Array<{ projectId: string; itemId: string }>>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [canSubmit, setCanSubmit] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [itemId, setItemId] = useState("");
  const [requestType, setRequestType] = useState("REPAIR");
  const [units, setUnits] = useState("1");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [followupFiles, setFollowupFiles] = useState<Record<string, File[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("action");
  const [tabChosen, setTabChosen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/maintenance", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to load maintenance requests.");
      setProjects(data.projects ?? []);
      setItems(data.items ?? []);
      setPairs(data.pairs ?? []);
      setTickets(data.tickets ?? []);
      setCanSubmit(Boolean(data.canSubmit));
      setIsAdmin(Boolean(data.isAdmin));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load maintenance requests.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A single project is chosen automatically; a stale choice is ignored.
  const selectedProjectId = projects.length === 1 ? projects[0].id : projects.some((p) => p.id === projectId) ? projectId : "";

  // Items offered for the chosen project: only combinations that have a workflow the person may submit to.
  const itemsForProject = useMemo(() => {
    const allowed = new Set(pairs.filter((pair) => pair.projectId === selectedProjectId).map((pair) => pair.itemId));
    return items.filter((item) => allowed.has(item.id));
  }, [items, pairs, selectedProjectId]);

  // When the project has exactly one item, it is chosen automatically.
  const selectedItemId = itemsForProject.length === 1 ? itemsForProject[0].id : itemsForProject.some((i) => i.id === itemId) ? itemId : "";

  const needsMyAction = tickets.filter((t) => t.canAct);
  const myRequests = tickets.filter((t) => t.isRequester);

  // Open on "Needs my action" when there is something waiting, otherwise on the person's own requests, otherwise all.
  const activeTab: Tab = tabChosen ? tab : needsMyAction.length > 0 ? "action" : myRequests.length > 0 ? "mine" : "all";
  const visibleTickets = activeTab === "action" ? needsMyAction : activeTab === "mine" ? myRequests : tickets;
  const ticketPages = usePagination(visibleTickets, { storageKey: "maintenance-tickets", initialPageSize: 10 });

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData();
      form.set("projectId", selectedProjectId); form.set("itemId", selectedItemId); form.set("requestType", requestType); form.set("units", units.trim()); form.set("phoneNumber", phoneNumber.trim()); form.set("description", description);
      attachments.forEach((file) => form.append("attachments", file));
      const response = await fetch("/api/maintenance", { method: "POST", headers: { "x-csrf-token": getCsrfTokenFromBrowser() }, body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to submit ticket.");
      setNotice(`Ticket ${data.ticket.ticketNumber} submitted successfully.`);
      setPhoneNumber(""); setDescription(""); setUnits("1"); setAttachments([]); setFileInputKey((k) => k + 1);
      setTabChosen(true); setTab("mine"); setItemId("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unexpected error."); }
    finally { setBusy(false); }
  }

  async function completeLevel(ticketId: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData();
      (followupFiles[ticketId] ?? []).forEach((file) => form.append("attachments", file));
      const response = await fetch(`/api/maintenance/${ticketId}/complete`, { method: "POST", headers: { "x-csrf-token": getCsrfTokenFromBrowser() }, body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to complete this level.");
      setNotice(data.message);
      setFollowupFiles((current) => { const next = { ...current }; delete next[ticketId]; return next; });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unexpected error."); await load(); }
    finally { setBusy(false); }
  }

  const formatDate = (value: string) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const formatSize = (value: number) => value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
  const statusLabel = (t: Ticket) => t.status === "CLOSED" ? "Closed" : t.status === "OPEN" ? "Awaiting level 1" : `In progress · level ${t.currentLevel}`;
  const waitingOn = (t: Ticket) => {
    const step = t.steps.find((s) => s.levelNumber === t.currentLevel);
    return step ? step.approvers.map((a) => a.user?.name ?? a.userType?.name ?? "").filter(Boolean).join(", ") : "";
  };

  const tabButton = (key: Tab, label: string, count: number) => (
    <button key={key} type="button" onClick={() => { setTab(key); setTabChosen(true); }} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${activeTab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
      {label} <span className={`ml-1 text-xs ${activeTab === key ? "text-slate-300" : "text-slate-500"}`}>{count}</span>
    </button>
  );

  return <div className="space-y-6">
    {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
    {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div> : null}

    {loaded && !canSubmit && isAdmin ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">No maintenance workflow is assigned to a project and item yet, so no tickets can be submitted. Set one up in <b>Maintenance Setup</b>.</div> : null}

    {canSubmit ? <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">New maintenance request</h2><p className="mt-1 text-sm text-slate-500">Submit a repair or new installation request.</p></div>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Project
          <select required value={selectedProjectId} onChange={(e) => { setProjectId(e.target.value); setItemId(""); }} className={fieldClass}>
            {projects.length !== 1 ? <option value="">Select project</option> : null}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">Item
          <select required value={selectedItemId} onChange={(e) => setItemId(e.target.value)} disabled={!selectedProjectId} className={`${fieldClass} disabled:bg-slate-100`}>
            {itemsForProject.length !== 1 ? <option value="">{selectedProjectId ? "Select item" : "Select a project first"}</option> : null}
            {itemsForProject.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">Number of units
          <input required type="number" min={1} step={1} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} className={fieldClass} />
          <span className="mt-1 block text-xs font-normal text-slate-500">How many units need repair or installation.</span>
        </label>
        <fieldset className="text-sm font-medium text-slate-700">
          <legend>Request type</legend>
          <div className="mt-2 flex gap-3">
            {([["REPAIR", "Repair"], ["NEW_INSTALLATION", "New installation"]] as const).map(([value, label]) => (
              <label key={value} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-normal ${requestType === value ? "border-slate-900 bg-slate-50" : "border-slate-300"}`}>
                <input type="radio" name="requestType" value={value} checked={requestType === value} onChange={() => setRequestType(value)} />{label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="text-sm font-medium text-slate-700 md:col-span-2">Contact phone number
          <input required type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={fieldClass} placeholder="e.g. +965 5555 0000" autoComplete="tel" />
        </label>
        <label className="text-sm font-medium text-slate-700 md:col-span-2">Description
          <textarea required value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={fieldClass} placeholder="Describe the issue or the installation required." />
        </label>
        <label className="text-sm font-medium text-slate-700 md:col-span-2">Attachments (optional)
          <input key={fileInputKey} type="file" multiple accept={FILE_ACCEPT} onChange={(e) => setAttachments(Array.from(e.target.files ?? []))} className="mt-1 block w-full text-sm" />
          <span className="mt-1 block text-xs font-normal text-slate-500">Up to 10 files; PDF, DOCX, XLSX, JPG and PNG; maximum 20 MB each.</span>
        </label>
        <div className="md:col-span-2"><button disabled={busy || !selectedProjectId || !selectedItemId} className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Please wait…" : "Submit maintenance ticket"}</button></div>
      </form>
    </section> : null}

    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div><h2 className="font-semibold text-slate-900">Maintenance tickets</h2><p className="mt-1 text-sm text-slate-500">Your requests and tickets waiting on you.</p></div>
        <div className="flex flex-wrap gap-2">{tabButton("action", "Needs my action", needsMyAction.length)}{tabButton("mine", "My requests", myRequests.length)}{tabButton("all", "All", tickets.length)}</div>
      </div>
      <div className="divide-y divide-slate-100">
        {!loaded ? <p className="p-6 text-center text-sm text-slate-500">Loading…</p>
          : visibleTickets.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">{activeTab === "action" ? "Nothing is waiting for your action." : "No maintenance tickets to show."}</p>
          : ticketPages.pageItems.map((ticket) => <article key={ticket.id} className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-slate-900">{ticket.ticketNumber}</h3>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ticket.status === "CLOSED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{statusLabel(ticket)}</span>
                {ticket.canAct ? <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">Your action</span> : null}
              </div>
              <p className="mt-1 text-sm text-slate-600">{ticket.project.code} - {ticket.project.name} · {ticket.item.name} · {ticket.units} unit(s) · {ticket.requestType === "REPAIR" ? "Repair" : "New installation"}</p>
            </div>
            <span className="text-xs text-slate-500">Submitted {formatDate(ticket.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{ticket.description}</p>
          <p className="text-xs text-slate-500">Requester: {ticket.requester.name} · Contact: {ticket.phoneNumber}{ticket.status !== "CLOSED" && waitingOn(ticket) ? ` · Waiting on: ${waitingOn(ticket)}` : ""}</p>
          <div className="flex flex-wrap gap-2">{ticket.steps.map((step) => <span key={step.id} className={`rounded-md px-2 py-1 text-xs ${step.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : step.levelNumber === ticket.currentLevel && ticket.status !== "CLOSED" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"}`}>L{step.levelNumber}: {step.name}{step.status === "COMPLETED" ? ` · ${step.actedBy?.name ?? "Completed"}${step.actedAt ? ` · ${formatDate(step.actedAt)}` : ""}` : ""}</span>)}</div>
          {ticket.attachments.length ? <div className="flex flex-wrap gap-2">{ticket.attachments.map((file) => <a key={file.id} href={`/api/maintenance/${ticket.id}/attachments/${file.id}`} className="text-xs font-medium text-blue-700 underline">{file.originalName} ({formatSize(file.fileSize)})</a>)}</div> : null}
          {ticket.canAct ? <div className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-3">
            <label className="min-w-56 flex-1 text-xs font-semibold text-slate-600">Add attachments (optional)
              <input type="file" multiple accept={FILE_ACCEPT} onChange={(e) => setFollowupFiles((current) => ({ ...current, [ticket.id]: Array.from(e.target.files ?? []) }))} className="mt-1 block w-full text-sm font-normal" />
            </label>
            <button disabled={busy} onClick={() => void completeLevel(ticket.id)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Please wait…" : ticket.currentLevel === ticket.steps.length ? "Complete and close ticket" : "Complete level and forward"}</button>
          </div> : null}
        </article>)}
      </div>
      {loaded ? <Pager {...ticketPages} noun="tickets" /> : null}
    </section>
  </div>;
}
