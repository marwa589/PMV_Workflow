"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Pill, primaryButton, secondaryButton } from "@/components/admin/admin-ui";
import ExistingDocumentPicker from "@/components/existing-document-picker";

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
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ runs: Run[]; startable?: Startable[] }>("/api/processes");
    if (!result.ok) return setError(result.message);
    setRuns(result.data.runs);
    setStartable(result.data.startable ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startWithExisting(processDefinitionId: string, documentId: string, options: { notify: boolean }) {
    setError(null);
    setStarting(true);
    const result = await callApi<{ processRunId: string }>("/api/processes", "POST", { processDefinitionId, documentId, notify: options.notify });
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
                    <button type="button" className={secondaryButton} onClick={() => setPickingProcessId(pickingProcessId === process.id ? null : process.id)}>
                      Start with an approved document
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
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="Process runs" subtitle="A run starts when the first document of a process is uploaded. Uploads for the next documents are in My Tasks.">
        {runs.length === 0 ? <Empty>No process runs to show.</Empty> : null}
        <div className="overflow-x-auto">
          {runs.length > 0 ? (
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Process</th>
                  <th className="px-3 py-2 font-semibold">Reference</th>
                  <th className="px-3 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-slate-100">
                    <td className="px-3 py-3"><Link href={`/processes/${run.id}`} className="font-medium text-cyan-700 hover:underline">{run.processDefinition.name}</Link></td>
                    <td className="px-3 py-3 text-slate-700">
                      {run.reference || "—"}
                      {run.follows ? (
                        <span className="block text-xs text-slate-500">
                          Follows <Link href={`/processes/${run.follows.runId}`} className="font-medium text-cyan-700 hover:underline">{run.follows.documentNumber ?? run.follows.reference ?? "previous run"}</Link>
                        </span>
                      ) : null}
                      {run.followUpCount > 0 ? <span className="block text-xs text-slate-500">{run.followUpCount} follow-up run{run.followUpCount === 1 ? "" : "s"}</span> : null}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{run.project ? `${run.project.code} - ${run.project.name}` : "—"}</td>
                    <td className="px-3 py-3"><Pill tone={statusTone[run.status]}>{run.statusLabel}</Pill></td>
                    <td className="px-3 py-3 text-slate-500">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(run.startedAt))} by {run.startedBy.name}</td>
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
