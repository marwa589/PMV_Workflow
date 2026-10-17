type ProcessStatusStep = {
  stepNumber: number;
  documentType: { code: string };
  documentSubtype: { code: string } | null;
};

export function getProcessStatusLabel(status: string, currentStepNumber: number, steps: readonly ProcessStatusStep[]): string {
  if (status === "COMPLETED") return "Completed";
  if (status === "CANCELLED") return "Cancelled";

  const currentStep = steps.find((step) => step.stepNumber === currentStepNumber);
  if (!currentStep) return "In Progress";

  const awaitedCode = `${currentStep.documentType.code}${currentStep.documentSubtype ? `-${currentStep.documentSubtype.code}` : ""}`;
  return `Awaiting ${awaitedCode}`;
}
