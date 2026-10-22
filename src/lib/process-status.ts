type StatusStep = {
  id: string;
  parentStepId: string | null;
  documentType: { code: string };
  documentSubtype: { code: string } | null;
};

type StatusLink = {
  processStepId: string;
  isCurrent: boolean;
  document: { status: string };
};

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
  return `Awaiting ${choices.map(stepCode).join(" or ")}`;
}
