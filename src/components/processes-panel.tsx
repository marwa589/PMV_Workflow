"use client";

import Link from "next/link";
import { useColumnPreferences } from "@/components/column-picker";
import { Pager, usePagination } from "@/components/pager";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Pill, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";
import ExistingDocumentPicker from "@/components/existing-document-picker";
import WhoCanAct from "@/components/admin/who-can-act";
import type { WhoCanUploadOption } from "@/lib/workflow/who-can-upload";

type Run = {
  id: string;
  reference: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  statusLabel: string;
  processDefinition: { id: string; name: string };
  project: { id: string; code: string; name: string } | null;
  startedBy: { id: string; name: string };
  startedAt: string;
  follows: { runId: string; reference: string | null; documentNumber: string | null } | null;
  followUpCount: number;
  // Admin only: who may upload each open choice while the run waits for its next document.
  whoCanUpload?: WhoCanUploadOption[];
};

type Startable = {
  id: string;
  name: string;
  description: string | null;
  rootName: string;
  documentTypeId: string;
  documentSubtypeId: string | null;
  typeName: string;
  subtypeName: string | null;
};

const statusTone = { IN_PROGRESS: "amber", COMPLETED: "green", CANCELLED: "slate" } as const;

/**
 * Process runs the person can see. A run begins when the root document of a process is uploaded; an Admin user
 * can also start one on purpose from here (the first document may already be approved). The next documents are
 * uploaded from My Tasks, or by an Admin user from the run page.
 */
export default function ProcessesPanel() {
  const [runs, setRuns] = useState<Run[]>([]);
  const router = useRouter();
  const [startable, setStartable] = useState<Startable[]>([]);
  const [pickingProcessId, setPickingProcessId] = useState<string | null>(null);
  // Corrective action: start a new run with a document that already has one (the reason is kept in the audit log).
  const [correctiveProcessId, setCorrectiveProcessId] = useState<string | null>(null);
  const [correctiveReason, setCorrectiveReason] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runPages = usePagination(runs, { storageKey: "process-runs", initialPageSize: 25 });
  const { isShown, picker } = useColumnPreferences("process-runs", [
    { key: "process", label: "Process" },
    { key: "reference", label: "Reference" },
    { key: "project", label: "Project" },
    { key: "status", label: "Status" },
    { key: "started", label: "Started" },
    { key: "whoCanUpload", label: "Who can upload" },
  ]);

  const load = useCallback(async () => {
    const result = await callApi<{ runs: Run[]; startable?: Startable[] }>("/api/processes");
    if (!result.ok) return setError(result.message);
    setRuns(result.data.runs);
    setStartable(result.data.startable ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startWithExisting(processDefinitionId: string, documentId: string, options: { notify: boolean }, corrective = false) {
    setError(null);
    if (corrective && correctiveReason.trim().length < 5) return setError("Enter the reason for this corrective run first.");
    setStarting(true);
    const result = await callApi<{ processRunId: string }>("/api/processes", "POST", {
      processDefinitionId,
      documentId,
      notify: options.notify,
      ...(corrective ? { corrective: true, reason: correctiveReason.trim() } : {}),
    });
    setStarting(false);
    if (!result.ok) return setError(result.message);
    router.push(`/processes/${result.data.processRunId}`);
  }

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}

      {startable.length > 0 ? (
        <Card title="Start a process" subtitle="Start a process with a new file (it can be saved as already approved) or with an approved document that is already in the system. Then add the documents of the next steps from the run page.">
          <ul className="divide-y divide-slate-100">
            {startable.map((process) => (
              <li key={process.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{process.name}</p>
                    <p className="text-xs text-slate-500">
                      Starts with {process.rootName} ({process.typeName}{process.subtypeName ? ` - ${process.subtypeName}` : ""})
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={secondaryButton} onClick={() => { setCorrectiveProcessId(null); setPickingProcessId(pickingProcessId === process.id ? null : process.id); }}>
                      Start with an approved document
                    </button>
                    <button type="button" className={secondaryButton} onClick={() => { setPickingProcessId(null); setCorrectiveProcessId(correctiveProcessId === process.id ? null : process.id); }}>
                      Corrective run
                    </button>
                    <Link href={`/new-document?startProcessId=${process.id}`} className={primaryButton}>Start with a new file</Link>
                  </div>
                </div>
                {pickingProcessId === process.id ? (
                  <ExistingDocumentPicker
                    documentTypeId={process.documentTypeId}
                    documentSubtypeId={process.documentSubtypeId}
                    busy={starting}
                    onPick={(documentId, options) => void startWithExisting(process.id, documentId, options)}
                    onCancel={() => setPickingProcessId(null)}
                  />
                ) : null}
                {correctiveProcessId === process.id ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm text-amber-900">
                      Corrective action: start a new run with an approved document that already has a run. The earlier runs stay as they are; the new run is independent of them.
                    </p>
                    <input
                      value={correctiveReason}
                      onChange={(e) => setCorrectiveReason(e.target.value)}
                      placeholder="Reason for the corrective run (required)"
                      className={`${inputClass} mt-2 max-w-xl`}
                    />
                    <ExistingDocumentPicker
                      documentTypeId={process.documentTypeId}
                      documentSubtypeId={process.documentSubtypeId}
                      includeUsed
                      busy={starting}
                      onPick={(documentId, options) => void startWithExisting(process.id, documentId, options, true)}
                      onCancel={() => setCorrectiveProcessId(null)}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Process runs" subtitle="A run starts when the first document of a process is uploaded. Uploads for the next documents are in My Tasks.">
        {runs.length === 0 ? <Empty>No process runs to show.</Empty> : <div className="mb-2 flex justify-end">{picker}</div>}
        <div className="overflow-x-auto">
          {runs.length > 0 ? (
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {isShown("process") ? <th className="px-3 py-2 font-semibold">Process</th> : null}
                  {isShown("reference") ? <th className="px-3 py-2 font-semibold">Reference</th> : null}
                  {isShown("project") ? <th className="px-3 py-2 font-semibold">Project</th> : null}
                  {isShown("status") ? <th className="px-3 py-2 font-semibold">Status</th> : null}
                  {isShown("started") ? <th className="px-3 py-2 font-semibold">Started</th> : null}
                  {isShown("whoCanUpload") ? <th className="px-3 py-2 font-semibold">Who can upload</th> : null}
                </tr>
              </thead>
              <tbody>
                {runPages.pageItems.map((run) => (
                  <tr key={run.id} className="border-t border-slate-100">
                    {isShown("process") ? (
<td className="px-3 py-3"><Link href={`/processes/${run.id}`} className="font-medium text-cyan-700 hover:underline">{run.processDefinition.name}</Link></td>
) : null}
                    {isShown("reference") ? (
<td className="px-3 py-3 text-slate-700">
                      {run.reference || "—"}
                      {run.follows ? (
                        <span className="block text-xs text-slate-500">
                          Follows <Link href={`/processes/${run.follows.runId}`} className="font-medium text-cyan-700 hover:underline">{run.follows.documentNumber ?? run.follows.reference ?? "previous run"}</Link>
                        </span>
                      ) : null}
                      {run.followUpCount > 0 ? <span className="block text-xs text-slate-500">{run.followUpCount} follow-up run{run.followUpCount === 1 ? "" : "s"}</span> : null}
                    </td>
) : null}
                    {isShown("project") ? (
<td className="px-3 py-3 text-slate-700">{run.project ? `${run.project.code} - ${run.project.name}` : "—"}</td>
) : null}
                    {isShown("status") ? (
<td className="px-3 py-3"><Pill tone={statusTone[run.status]}>{run.statusLabel}</Pill></td>
) : null}
                    {isShown("started") ? (
<td className="px-3 py-3 text-slate-500">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(run.startedAt))} by {run.startedBy.name}</td>
) : null}
                    {isShown("whoCanUpload") ? (
<td className="px-3 py-3 align-top">
                      {(run.whoCanUpload ?? []).length === 0 ? (
                        <span className="text-slate-400">{run.status === "IN_PROGRESS" ? "Not waiting for an upload" : "—"}</span>
                      ) : (
                        <div className="space-y-2">
                          {(run.whoCanUpload ?? []).map((option) => (
                            <WhoCanAct key={option.stepId} people={option.people} label={(run.whoCanUpload ?? []).length > 1 ? `${option.name}: who can upload` : "Who can upload"} />
                          ))}
                        </div>
                      )}
                    </td>
) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        <Pager {...runPages} noun="runs" />
      </Card>
    </div>
  );
}
