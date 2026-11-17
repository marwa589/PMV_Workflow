import { getDocumentStatusDisplay } from "@/lib/document-status";
import { stepSortKey } from "@/lib/workflow/tracks";

export type JourneyStep = {
  levelNumber: number;
  name: string | null;
  // The state of this level on this document: WAITING, PENDING, APPROVED, REJECTED, REVISION or ON_HOLD.
  status: string;
  // Set on a step created by "Send for approval": it sits right after the level it was sent from.
  originLevel?: number | null;
  isSideApproval?: boolean;
};

type Props = {
  status: string;
  currentWorkflowStep: number | null;
  // The levels copied onto the document when it was uploaded (level 0 is the uploader step).
  steps: JourneyStep[];
  // When the person viewing this page last downloaded the approved document (null if they have not).
  downloadedAt?: Date | null;
};

function stepLabel(step: JourneyStep): string {
  if (step.levelNumber === 0) return "Submitted";
  return step.name?.trim() || `Level ${step.levelNumber}`;
}

/** Draws the document's own approval path, so it follows whatever flow the document was given. */
export default function WorkflowJourneyChart({ status, currentWorkflowStep, steps, downloadedAt = null }: Props) {
  // Levels a unique track skipped are left out; a track step sits right after the level it was taken at.
  const levels = [...steps].filter((step) => step.status !== "SKIPPED").sort((a, b) => stepSortKey(a.levelNumber, a.originLevel) - stepSortKey(b.levelNumber, b.originLevel));
  // While a document is with the person it was sent to for approval, the level it was sent from is still "in progress".
  const sentFromLevels = new Set(levels.filter((step) => step.isSideApproval && (step.status === "PENDING" || step.status === "ON_HOLD")).map((step) => step.originLevel));
  const nodes = [
    ...levels.map((step) => ({ label: stepLabel(step), state: step.status === "WAITING" && sentFromLevels.has(step.levelNumber) ? "PENDING" : step.status })),
    { label: "Completed", state: status === "APPROVED" || status === "ARCHIVED" ? "APPROVED" : "WAITING" },
  ];

  const currentName = levels.find((step) => step.levelNumber === currentWorkflowStep);
  const isDownloaded = Boolean(downloadedAt) && status === "APPROVED";
  const headline =
    status === "CANCELLED"
      ? `Rejected${currentName ? ` at ${stepLabel(currentName)}` : ""}`
      : isDownloaded
        ? "Downloaded"
        : getDocumentStatusDisplay(status, { levelNumber: currentWorkflowStep, name: currentName?.name ?? null });

  // How far along the line to fill: up to the last level that is done, or the current one.
  const lastReached = nodes.reduce((reached, node, index) => (node.state === "WAITING" ? reached : index), 0);
  const progress = nodes.length > 1 ? (lastReached / (nodes.length - 1)) * 100 : 0;

  const circleClass = (state: string) => {
    switch (state) {
      case "APPROVED":
        return "border-blue-600 bg-blue-600 text-white";
      case "REJECTED":
        return "border-red-600 bg-red-600 text-white";
      case "PENDING":
      case "ON_HOLD":
      case "REVISION":
        return "border-cyan-600 bg-white text-cyan-700 ring-4 ring-cyan-100";
      default:
        return "border-slate-300 bg-white text-slate-500";
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Workflow journey</p>
          <p className="text-sm text-slate-600">A quick view of where this document is in the approval path.</p>
        </div>
        <div className={`rounded-full px-3 py-1 text-sm font-medium ${status === "CANCELLED" ? "bg-red-50 text-red-700" : "bg-cyan-50 text-cyan-700"}`}>
          {headline}
        </div>
      </div>

      <div className="relative mx-auto max-w-3xl">
        <div className="absolute left-0 right-0 top-6 h-1 rounded-full bg-slate-200" />
        <div className="absolute left-0 top-6 h-1 rounded-full bg-cyan-600 transition-all" style={{ width: `${progress}%` }} />

        <div className="relative flex items-start justify-between gap-2">
          {nodes.map((node, index) => (
            <div key={`${node.label}-${index}`} className="flex flex-1 flex-col items-center text-center">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${circleClass(node.state)}`}>{index + 1}</div>
              <p className="mt-2 text-xs font-medium text-slate-700">{node.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
