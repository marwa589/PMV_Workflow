type StatusStep = {
  id: string;
  parentStepId: string | null;
  /** Hours to wait after the parent document's final approval before this step can be uploaded. */
  delayHours?: number;
  documentType: { code: string };
  documentSubtype: { code: string } | null;
};

type StatusLink = {
  processStepId: string;
  isCurrent: boolean;
  document: { status: string; approvedAt?: Date | null };
};

/** When a step with a waiting period opens: the parent's final approval plus delayHours. Null = no waiting period. */
export function stepOpensAt(parentApprovedAt: Date | null | undefined, delayHours: number | null | undefined): Date | null {
  if (!delayHours || delayHours <= 0 || !parentApprovedAt) return null;
  return new Date(parentApprovedAt.getTime() + delayHours * 60 * 60 * 1000);
}

const openFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function stepCode(step: StatusStep) {
  return `${step.documentType.code}${step.documentSubtype ? `-${step.documentSubtype.code}` : ""}`;
}

/**
 * One line that says where a process run stands.
 * currentStepId is the last approved node (null until the root document is approved); its children are the open choices.
 */
export function getProcessStatusLabel(
  run: { status: string; currentStepId: string | null },
  steps: readonly StatusStep[],
  links: readonly StatusLink[],
): string {
  if (run.status === "COMPLETED") return "Completed";
  if (run.status === "CANCELLED") return "Cancelled";

  // A document is already in approval for the next node.
  const inApproval = links.find((link) => {
    if (!link.isCurrent || link.document.status === "APPROVED") return false;
    const step = steps.find((candidate) => candidate.id === link.processStepId);
    return step ? step.parentStepId === run.currentStepId : false;
  });
  if (inApproval) {
    const step = steps.find((candidate) => candidate.id === inApproval.processStepId);
    return step ? `In approval: ${stepCode(step)}` : "In Progress";
  }

  if (run.currentStepId === null) return "Awaiting approval of the first document";

  const choices = steps.filter((step) => step.parentStepId === run.currentStepId);
  if (choices.length === 0) return "In Progress";

  // Choices can have a waiting period after the previous document's final approval.
  const parentApprovedAt = links.find((link) => link.isCurrent && link.processStepId === run.currentStepId)?.document.approvedAt ?? null;
  const now = Date.now();
  const waiting = choices
    .map((step) => ({ step, opensAt: stepOpensAt(parentApprovedAt, step.delayHours) }))
    .filter((entry): entry is { step: StatusStep; opensAt: Date } => entry.opensAt !== null && entry.opensAt.getTime() > now);
  const open = choices.filter((step) => !waiting.some((entry) => entry.step.id === step.id));

  if (waiting.length === 0) return `Awaiting ${choices.map(stepCode).join(" or ")}`;
  const earliest = waiting.reduce((min, entry) => (entry.opensAt < min ? entry.opensAt : min), waiting[0].opensAt);
  if (open.length === 0) return `Waiting period: ${choices.map(stepCode).join(" or ")} opens ${openFormat.format(earliest)}`;
  return `Awaiting ${open.map(stepCode).join(" or ")} (${waiting.map((entry) => stepCode(entry.step)).join(" or ")} opens ${openFormat.format(earliest)})`;
}
