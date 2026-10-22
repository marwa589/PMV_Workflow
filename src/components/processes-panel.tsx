"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Pill } from "@/components/admin/admin-ui";

type Run = {
  id: string;
  reference: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  statusLabel: string;
  processDefinition: { id: string; name: string };
  project: { id: string; code: string; name: string } | null;
  startedBy: { id: string; name: string };
  startedAt: string;
};

const statusTone = { IN_PROGRESS: "amber", COMPLETED: "green", CANCELLED: "slate" } as const;

/**
 * Process runs the person can see (for tracking only). Runs are never started here: a run begins by itself when
 * the root document of a process is uploaded, and its next documents are uploaded from My Tasks.
 */
export default function ProcessesPanel() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ runs: Run[] }>("/api/processes");
    if (!result.ok) return setError(result.message);
    setRuns(result.data.runs);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}

      <Card title="Process runs" subtitle="A run starts automatically when the first document of a process is uploaded. Uploads for the next documents are in My Tasks.">
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
                    <td className="px-3 py-3 text-slate-700">{run.reference || "—"}</td>
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
