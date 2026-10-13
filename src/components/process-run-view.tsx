"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "@/lib/admin-client";
import StatusBadge from "@/components/status-badge";
import { Banner, Card, Pill, dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type DocRef = { linkId: string; isCurrent: boolean; source: string; linkedAt: string; id: string; documentNumber: string; title: string; status: string; statusLabel: string };
type Step = {
  id: string;
  stepNumber: number;
  name: string;
  documentType: { id: string; code: string; name: string };
  documentSubtype: { id: string; code: string; name: string } | null;
  currentDocument: DocRef | null;
  history: DocRef[];
};
type Run = {
  id: string;
  reference: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  currentStepNumber: number;
  startedAt: string;
  completedAt: string | null;
  project: { id: string; code: string; name: string } | null;
  startedBy: { id: string; name: string };
  processDefinition: { id: string; name: string };
  steps: Step[];
};
type Candidate = { id: string; documentNumber: string; title: string; status: string; updatedAt: string };

/** One process run: its steps in order, the document filling each, and what to do next. */
export default function ProcessRunView({ runId }: { runId: string }) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  const load = useCallback(async () => {
    const result = await callApi<{ run: Run }>(`/api/processes/${runId}`);
    if (!result.ok) return setError(result.message);
    setRun(result.data.run);
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentStep = run?.steps.find((step) => step.stepNumber === run.currentStepNumber) ?? null;
  // A step can take a new document when it is empty, or its document was rejected.
  const stepIsOpen = Boolean(run && run.status === "IN_PROGRESS" && currentStep && (!currentStep.currentDocument || currentStep.currentDocument.status === "CANCELLED"));

  async function findExisting() {
    if (!currentStep) return;
    setError(null);
    const params = new URLSearchParams({ documentTypeId: currentStep.documentType.id, search });
    if (currentStep.documentSubtype) params.set("documentSubtypeId", currentStep.documentSubtype.id);
    const result = await callApi<{ documents: Candidate[] }>(`/api/documents/linkable?${params.toString()}`);
    if (!result.ok) return setError(result.message);
    setCandidates(result.data.documents);
  }

  async function link(documentId: string) {
    setError(null);
    setNotice(null);
    const result = await callApi(`/api/processes/${runId}/link`, "POST", { documentId });
    if (!result.ok) return setError(result.message);
    setNotice("Document added to the step.");
    setCandidates(null);
    await load();
    router.refresh();
  }

  async function cancel() {
    if (!window.confirm("Cancel this process run?")) return;
    setError(null);
    const result = await callApi(`/api/processes/${runId}`, "PATCH", { action: "cancel" });
    if (!result.ok) return setError(result.message);
    await load();
  }

  if (!run) return error ? <Banner kind="error">{error}</Banner> : <p className="text-sm text-slate-500">Loading...</p>;

  const title = `${run.processDefinition.name}${run.reference ? ` - ${run.reference}` : ""}`;

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}
      {notice ? <Banner kind="success">{notice}</Banner> : null}

      <Card
        title={title}
        subtitle={`${run.project ? `${run.project.code} - ${run.project.name} · ` : ""}started by ${run.startedBy.name} on ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(run.startedAt))}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={run.status === "COMPLETED" ? "green" : run.status === "CANCELLED" ? "slate" : "amber"}>{run.status.replaceAll("_", " ").toLowerCase()}</Pill>
            <a href={`/api/processes/${run.id}/package-download`} className={secondaryButton}>Download package (PDF)</a>
            {run.status === "IN_PROGRESS" ? <button type="button" className={dangerButton} onClick={cancel}>Cancel run</button> : null}
          </div>
        }
      >
        <ol className="space-y-4">
          {run.steps.map((step) => {
            const isCurrent = run.status === "IN_PROGRESS" && step.stepNumber === run.currentStepNumber;
            const done = step.currentDocument?.status === "APPROVED" || step.currentDocument?.status === "ARCHIVED";
            return (
              <li key={step.id} className={`rounded-xl border p-4 ${isCurrent ? "border-cyan-300 bg-cyan-50/40" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Pill tone={done ? "green" : isCurrent ? "amber" : "slate"}>Step {step.stepNumber}</Pill>
                    <span className="font-semibold text-slate-900">{step.name}</span>
                    <span className="text-xs text-slate-500">{step.documentType.name}{step.documentSubtype ? ` - ${step.documentSubtype.name}` : ""}</span>
                  </div>
                  {step.currentDocument ? (
                    <div className="flex items-center gap-3 text-sm">
                      <StatusBadge status={step.currentDocument.status} label={step.currentDocument.statusLabel} />
                      <Link href={`/documents/${step.currentDocument.id}`} className="font-medium text-cyan-700 hover:underline">{step.currentDocument.documentNumber}</Link>
                    </div>
                  ) : (
                    <span className="text-sm text-slate-500">{isCurrent ? "Waiting for a document" : "Not reached yet"}</span>
                  )}
                </div>

                {step.history.length > 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Earlier: {step.history.map((item) => `${item.documentNumber} (${item.statusLabel})`).join(", ")}
                  </p>
                ) : null}

                {isCurrent && stepIsOpen ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/new-document?processInstanceId=${run.id}`} className={primaryButton}>Upload a new document</Link>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find an existing document by number or title" className={`${inputClass} max-w-md`} />
                      <button type="button" className={secondaryButton} onClick={findExisting}>Search</button>
                    </div>
                    {candidates ? (
                      candidates.length === 0 ? (
                        <p className="text-sm text-slate-500">No matching documents.</p>
                      ) : (
                        <div className="space-y-2">
                          {candidates.map((candidate) => (
                            <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                              <span><span className="font-medium text-slate-900">{candidate.documentNumber}</span> · {candidate.title} <span className="text-slate-500">({candidate.status.toLowerCase()}, {candidate.updatedAt})</span></span>
                              <button type="button" className={secondaryButton} onClick={() => link(candidate.id)}>Use this document</button>
                            </div>
                          ))}
                        </div>
                      )
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
