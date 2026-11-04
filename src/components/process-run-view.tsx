"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { callApi } from "@/lib/admin-client";
import StatusBadge from "@/components/status-badge";
import ExistingDocumentPicker from "@/components/existing-document-picker";
import { Banner, Card, Pill, dangerButton, primaryButton, secondaryButton } from "@/components/admin/admin-ui";

type DocRef = {
  linkId: string;
  isCurrent: boolean;
  source: string;
  linkedAt: string;
  id: string;
  documentNumber: string;
  title: string;
  status: string;
  statusLabel: string;
  // Present only when the viewer holds "View reference documents" for it.
  referenceDocuments: Array<{ id: string; documentNumber: string; title: string }>;
};
type Step = {
  id: string;
  stepNumber: number;
  name: string;
  parentStepId: string | null;
  documentType: { id: string; code: string; name: string };
  documentSubtype: { id: string; code: string; name: string } | null;
  delayHours: number;
  referenceType: string | null;
  opensAt: string | null;
  onPath: boolean;
  isOpenChoice: boolean;
  currentDocument: DocRef | null;
  history: DocRef[];
};
type Run = {
  id: string;
  reference: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  statusLabel: string;
  currentStepId: string | null;
  awaitingUpload: boolean;
  canUpload: boolean;
  canCancel: boolean;
  startedAt: string;
  completedAt: string | null;
  project: { id: string; code: string; name: string } | null;
  startedBy: { id: string; name: string };
  processDefinition: { id: string; name: string };
  // Set when this run was started by an "allow multiple uploads" batch: the run and approved document it follows.
  follows: { run: { id: string; reference: string | null; name: string }; document: { id: string; documentNumber: string; title: string } | null } | null;
  // Runs that follow this one (one per document of a multiple upload).
  followUps: Array<{
    id: string;
    reference: string | null;
    status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    document: { id: string; documentNumber: string; title: string; status: string; statusLabel: string } | null;
  }>;
  steps: Step[];
};

/**
 * One process run shown as its tree: the path taken so far, the documents that filled it, the choices that are
 * open now, and the branches that were not chosen. Documents are never linked here; they enter the run by upload.
 */
export default function ProcessRunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The open step whose "pick an existing approved document" list is showing, and whether a pick is being saved.
  const [pickingStepId, setPickingStepId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => {
    const result = await callApi<{ run: Run }>(`/api/processes/${runId}`);
    if (!result.ok) return setError(result.message);
    setRun(result.data.run);
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel() {
    if (!window.confirm("Cancel this process run?")) return;
    setError(null);
    const result = await callApi(`/api/processes/${runId}`, "PATCH", { action: "cancel" });
    if (!result.ok) return setError(result.message);
    await load();
  }

  async function linkExisting(stepId: string, documentId: string, options: { notify: boolean }) {
    setError(null);
    setLinking(true);
    const result = await callApi(`/api/processes/${runId}/link`, "POST", { stepId, documentId, notify: options.notify });
    setLinking(false);
    if (!result.ok) return setError(result.message);
    setPickingStepId(null);
    await load();
  }

  if (!run) return error ? <Banner kind="error">{error}</Banner> : <p className="text-sm text-slate-500">Loading...</p>;

  const title = `${run.processDefinition.name}${run.reference ? ` - ${run.reference}` : ""}`;
  const root = run.steps.find((step) => step.parentStepId === null) ?? null;

  function renderStep(step: Step, depth: number): ReactNode {
    const children = run!.steps.filter((candidate) => candidate.parentStepId === step.id);
    const siblings = run!.steps.filter((candidate) => candidate.parentStepId === step.parentStepId && candidate.id !== step.id);
    const done = step.currentDocument?.status === "APPROVED" || step.currentDocument?.status === "ARCHIVED";
    const siblingChosen = siblings.some((sibling) => sibling.currentDocument !== null);
    const notChosen = !step.currentDocument && siblingChosen;
    const stillOpen = run!.status === "IN_PROGRESS";

    let note = "";
    if (!step.currentDocument) {
      if (notChosen) note = "Not chosen";
      else if (step.isOpenChoice && step.opensAt) note = `Waiting period: opens ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(step.opensAt))}`;
      else if (step.isOpenChoice) note = "Open choice: waiting for an upload";
      else note = stillOpen ? "Not reached yet" : "Not reached";
    }

    return (
      <li key={step.id} className={depth > 0 ? "ml-5 border-l-2 border-slate-200 pl-4" : ""}>
        <div className={`rounded-xl border p-4 ${step.isOpenChoice ? "border-cyan-300 bg-cyan-50/40" : step.onPath ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200"} ${notChosen ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone={done ? "green" : step.isOpenChoice || step.currentDocument ? "amber" : "slate"}>{step.parentStepId === null ? "Start" : "Next"}</Pill>
              <span className="font-semibold text-slate-900">{step.name}</span>
              <span className="text-xs text-slate-500">{step.documentType.name}{step.documentSubtype ? ` - ${step.documentSubtype.name}` : ""}</span>
            </div>
            {step.currentDocument ? (
              <div className="flex items-center gap-3 text-sm">
                <StatusBadge status={step.currentDocument.status} label={step.currentDocument.statusLabel} />
                <Link href={`/documents/${step.currentDocument.id}`} className="font-medium text-cyan-700 hover:underline">{step.currentDocument.documentNumber}</Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-slate-500">{note}</span>
                {step.isOpenChoice && run!.awaitingUpload && run!.canUpload ? (
                  <Link href={`/new-document?processInstanceId=${run!.id}&processStepId=${step.id}`} className={primaryButton}>
                    Upload document
                  </Link>
                ) : null}
                {step.isOpenChoice && run!.awaitingUpload && run!.canUpload ? (
                  <button type="button" className={secondaryButton} onClick={() => setPickingStepId(pickingStepId === step.id ? null : step.id)}>
                    Pick approved document
                  </button>
                ) : null}
              </div>
            )}
          </div>

          {pickingStepId === step.id ? (
            <ExistingDocumentPicker
              documentTypeId={step.documentType.id}
              documentSubtypeId={step.documentSubtype?.id ?? null}
              projectId={run!.project?.id ?? null}
              busy={linking}
              onPick={(documentId, options) => void linkExisting(step.id, documentId, options)}
              onCancel={() => setPickingStepId(null)}
            />
          ) : null}

          {step.currentDocument && step.currentDocument.referenceDocuments.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
              {step.currentDocument.referenceDocuments.map((reference) => (
                <li key={reference.id}>
                  Reference document:{" "}
                  <Link href={`/documents/${reference.id}`} className="font-medium text-cyan-700 hover:underline">
                    {reference.documentNumber}
                  </Link>{" "}
                  · {reference.title}
                </li>
              ))}
            </ul>
          ) : null}
          {step.delayHours > 0 ? <p className="mt-1 text-xs text-amber-700">Waits {step.delayHours} hour(s) after the previous document is approved.</p> : null}

          {step.history.length > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              Earlier (rejected): {step.history.map((item) => `${item.documentNumber} (${item.statusLabel})`).join(", ")}
            </p>
          ) : null}
        </div>

        {children.length > 0 ? (
          <ul className="mt-3 space-y-3">{children.map((child) => renderStep(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  return (
    <div className="space-y-6">
      {error ? <Banner kind="error">{error}</Banner> : null}

      <Card
        title={title}
        subtitle={`${run.project ? `${run.project.code} - ${run.project.name} · ` : ""}started by ${run.startedBy.name} on ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(run.startedAt))}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={run.status === "COMPLETED" ? "green" : run.status === "CANCELLED" ? "slate" : "amber"}>{run.statusLabel}</Pill>
            {run.awaitingUpload && run.canUpload ? <Link href={`/new-document?processInstanceId=${run.id}`} className={primaryButton}>Upload next document</Link> : null}
            <a href={`/api/processes/${run.id}/package-download`} className={secondaryButton}>Download package (PDF)</a>
            {run.canCancel ? <button type="button" className={dangerButton} onClick={cancel}>Cancel run</button> : null}
          </div>
        }
      >
        {run.awaitingUpload && run.canUpload ? (
          <p className="mb-4 text-sm text-slate-600">
            This process is waiting for its next document. Use the Upload button of the step you want (or choose one of the highlighted options on the upload page); the process follows the path of the one you choose. You can tick &quot;already approved&quot; on the upload page to add a document that was approved elsewhere.
          </p>
        ) : null}
        {run.follows ? (
          <p className="mb-4 rounded-xl border border-cyan-200 bg-cyan-50/50 px-4 py-3 text-sm text-slate-700">
            Follow-up run of{" "}
            <Link href={`/processes/${run.follows.run.id}`} className="font-medium text-cyan-700 hover:underline">
              {run.follows.run.name}{run.follows.run.reference ? ` - ${run.follows.run.reference}` : ""}
            </Link>
            {run.follows.document ? (
              <>
                , after{" "}
                <Link href={`/documents/${run.follows.document.id}`} className="font-medium text-cyan-700 hover:underline">{run.follows.document.documentNumber}</Link>
                {" "}· {run.follows.document.title}
              </>
            ) : null}
            .
          </p>
        ) : null}
        <ul className="space-y-3">{root ? renderStep(root, 0) : null}</ul>
      </Card>

      {run.followUps.length > 0 ? (
        <Card title="Follow-up runs" subtitle="Documents uploaded together after this run's last approved document. Each one is its own run.">
          <ul className="divide-y divide-slate-100">
            {run.followUps.map((followUp) => (
              <li key={followUp.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <Link href={`/processes/${followUp.id}`} className="font-medium text-cyan-700 hover:underline">
                  {followUp.reference ?? "Follow-up run"}
                </Link>
                <span className="text-slate-600">{followUp.document ? followUp.document.title : "—"}</span>
                {followUp.document ? <StatusBadge status={followUp.document.status} label={followUp.document.statusLabel} /> : <Pill tone={followUp.status === "COMPLETED" ? "green" : followUp.status === "CANCELLED" ? "slate" : "amber"}>{followUp.status === "IN_PROGRESS" ? "In progress" : followUp.status === "COMPLETED" ? "Completed" : "Cancelled"}</Pill>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
