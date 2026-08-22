import { DocumentStatus } from "@prisma/client";

type Props = {
  status: DocumentStatus;
  lastActiveStage?: DocumentStatus | null;
};

const steps = [
  { label: "Submitted", value: 0 },
  { label: "PMV Engineer", value: 1 },
  { label: "Workshop Manager", value: 2 },
  { label: "PMV Manager", value: 3 },
  { label: "Completed", value: 4 },
];

function getStageLabel(stage: DocumentStatus | null | undefined) {
  switch (stage) {
    case DocumentStatus.PENDING_APPROVER_1:
      return "PMV Engineer";
    case DocumentStatus.PENDING_APPROVER_2:
      return "Workshop Manager";
    case DocumentStatus.PENDING_APPROVER_3:
      return "PMV Manager";
    case DocumentStatus.REVISION_REQUIRED:
      return "Revision required";
    case DocumentStatus.APPROVED:
      return "Completed";
    case DocumentStatus.REJECTED:
      return "Rejected";
    default:
      return "Submitted";
  }
}

function resolveStepIndex(status: DocumentStatus, lastActiveStage?: DocumentStatus | null) {
  if (status === DocumentStatus.REJECTED && lastActiveStage) {
    return resolveStepIndex(lastActiveStage);
  }

  switch (status) {
    case DocumentStatus.PENDING_APPROVER_1:
      return 1;
    case DocumentStatus.PENDING_APPROVER_2:
      return 2;
    case DocumentStatus.PENDING_APPROVER_3:
      return 3;
    case DocumentStatus.REVISION_REQUIRED:
      return 3;
    case DocumentStatus.APPROVED:
      return 4;
    case DocumentStatus.REJECTED:
      return 4;
    case DocumentStatus.ARCHIVED:
      return 4;
    default:
      return 0;
  }
}

export default function WorkflowJourneyChart({ status, lastActiveStage }: Props) {
  const currentStep = resolveStepIndex(status, lastActiveStage);
  const stageLabel = status === DocumentStatus.REJECTED ? getStageLabel(lastActiveStage) : getStageLabel(status);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Workflow journey</p>
          <p className="text-sm text-slate-600">A quick view of where this document is in the approval path.</p>
        </div>
        <div className="rounded-full bg-cyan-50 px-3 py-1 text-sm font-medium text-cyan-700">
          {status === DocumentStatus.REJECTED ? `Rejected at ${stageLabel}` : stageLabel}
        </div>
      </div>

      <div className="relative mx-auto max-w-3xl">
        <div className="absolute left-0 right-0 top-6 h-1 rounded-full bg-slate-200" />
        <div
          className="absolute left-0 top-6 h-1 rounded-full bg-cyan-600 transition-all"
          style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
        />

        <div className="relative flex items-start justify-between gap-2">
          {steps.map((step, index) => {
            const isComplete = index < currentStep;
            const isCurrent = index === currentStep;
            return (
              <div key={step.label} className="flex flex-1 flex-col items-center text-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                    isComplete || isCurrent
                      ? "border-cyan-600 bg-cyan-600 text-white"
                      : "border-slate-300 bg-white text-slate-500"
                  }`}
                >
                  {index + 1}
                </div>
                <p className="mt-2 text-xs font-medium text-slate-700">{step.label}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
