"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import { Banner, Card, Empty, Field, Pill, inputClass, primaryButton } from "@/components/admin/admin-ui";

type Run = {
  id: string;
  reference: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  statusLabel: string;
  currentStepNumber: number;
  totalSteps: number;
  processDefinition: { id: string; name: string };
  project: { id: string; code: string; name: string } | null;
  startedBy: { id: string; name: string };
  startedAt: string;
};
type Startable = { id: string; name: string; description: string | null };

const statusTone = { IN_PROGRESS: "amber", COMPLETED: "green", CANCELLED: "slate" } as const;

/** Process runs the person can see, and the processes they may start. */
export default function ProcessesPanel({ projects }: { projects: Array<{ id: string; code: string; name: string }> }) {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [startable, setStartable] = useState<Startable[]>([]);
  const [form, setForm] = useState({ processDefinitionId: "", projectId: "", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const result = await callApi<{ runs: Run[]; startable: Startable[] }>("/api/processes");
    if (!result.ok) return setError(result.message);
    setRuns(result.data.runs);
    setStartable(result.data.startable);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    setStarting(true);
    setError(null);
    const result = await callApi<{ run: { id: string } }>("/api/processes", "POST", {
      processDefinitionId: form.processDefinitionId,
      projectId: form.projectId || null,
      reference: form.reference,
    });
    setStarting(false);
    if (!result.ok) return setError(result.message);
    router.push(`/processes/${result.data.run.id}`);
  }

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}

      {startable.length > 0 ? (
        <Card title="Start a process" subtitle="A run follows its steps in order. Each step is finished when its document is uploaded and fully approved.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Field label="Process">
              <select value={form.processDefinitionId} onChange={(e) => setForm({ ...form, processDefinitionId: e.target.value })} className={inputClass}>
                <option value="">Select a process</option>
                {startable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Project">
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className={inputClass}>
                <option value="">No project</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.code} - {project.name}</option>)}
              </select>
            </Field>
            <Field label="Reference"><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={inputClass} placeholder="e.g. Tyres purchase" /></Field>
            <div className="flex items-end">
              <button type="button" className={primaryButton} disabled={!form.processDefinitionId || starting} onClick={start}>{starting ? "Starting..." : "Start"}</button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card title="Process runs">
        {runs.length === 0 ? <Empty>No process runs to show.</Empty> : null}
        <div className="overflow-x-auto">
          {runs.length > 0 ? (
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Process</th>
                  <th className="px-3 py-2 font-semibold">Reference</th>
                  <th className="px-3 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Progress</th>
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
                    <td className="px-3 py-3 text-slate-700">{run.status === "COMPLETED" ? `${run.totalSteps} of ${run.totalSteps}` : `Step ${run.currentStepNumber} of ${run.totalSteps}`}</td>
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
