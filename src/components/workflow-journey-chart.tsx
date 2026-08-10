import { DocumentStatus } from "@prisma/client";

type Props = {
  status: DocumentStatus;
};

const steps = [
  { label: "Submitted", value: 0 },
  { label: "Approver 1", value: 1 },
  { label: "Approver 2", value: 2 },
  { label: "Approver 3", value: 3 },
  { label: "Completed", value: 4 },
];

function resolveStepIndex(status: DocumentStatus) {
  switch (status) {
    case DocumentStatus.PENDING_APPROVER_1:
      return 1;
    case DocumentStatus.PENDING_APPROVER_2:
      return 2;
    case DocumentStatus.PENDING_APPROVER_3:
      return 3;
    case DocumentStatus.APPROVED:
      return 4;
    case DocumentStatus.REJECTED:
      return 4;
    case DocumentStatus.REVISION_REQUIRED:
      return 2;
    case DocumentStatus.ARCHIVED:
      return 4;
    default:
      return 0;
  }
}

export default function WorkflowJourneyChart({ status }: Props) {
  const currentStep = resolveStepIndex(status);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Workflow journey</p>
          <p className="text-sm text-slate-600">A quick view of where this document is in the approval path.</p>
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
