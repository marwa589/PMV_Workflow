import { DocumentStatus, DocumentType, UserRole } from "@prisma/client";

export type SubmissionWorkflowContext = {
  uploaderLocation?: string | null;
  documentType?: string | null;
  documentSubtype?: string | null;
  projectName?: string | null;
};

type WorkflowTemplateLookup = {
  documentWorkflowTemplate: {
    findMany: (args: any) => Promise<any[]>;
  };
};

export type ResolvedSubmissionWorkflow = {
  templateId: string;
  stepNumber: number;
  status: DocumentStatus;
  approverId: string | null;
  approver: { id: string; email: string; name: string } | null;
};

export async function resolveDocumentWorkflowForSubmission(
  tx: WorkflowTemplateLookup,
  context: SubmissionWorkflowContext,
): Promise<ResolvedSubmissionWorkflow | null> {
  const documentType = context.documentType === "MATERIAL_REQUISITION" ? DocumentType.MATERIAL_REQUISITION : context.documentType === "COMPARISON" ? DocumentType.COMPARISON : null;

  if (!documentType) {
    return null;
  }

  const templates = await tx.documentWorkflowTemplate.findMany({
    where: {
      isActive: true,
      documentType,
      OR: [
        { location: context.uploaderLocation ?? undefined },
        { projectName: context.projectName ?? undefined },
        { documentSubtype: context.documentSubtype ?? undefined },
        { location: null, projectName: null, documentSubtype: null },
      ],
    },
    orderBy: [{ location: "desc" }, { projectName: "desc" }, { createdAt: "asc" }],
    include: {
      steps: {
        orderBy: { stepNumber: "asc" },
        include: { approver: { select: { id: true, email: true, name: true } } },
      },
    },
  });

  const bestMatch = templates.find((template: any) => {
    const locationMatches = !template.location || template.location === context.uploaderLocation;
    const projectMatches = !template.projectName || template.projectName === context.projectName;
    const subtypeMatches = !template.documentSubtype || template.documentSubtype === context.documentSubtype;
    return locationMatches && projectMatches && subtypeMatches;
  }) ?? templates[0] ?? null;

  if (!bestMatch || bestMatch.steps.length === 0) {
    return null;
  }

  const firstStep = bestMatch.steps[0];
  const approver = firstStep.approver ?? null;

  if (!approver && !firstStep.approverUserId) {
    return null;
  }

  const statusMap: Record<number, DocumentStatus> = {
    1: DocumentStatus.PENDING_APPROVER_1,
    2: DocumentStatus.PENDING_APPROVER_2,
    3: DocumentStatus.PENDING_APPROVER_3,
  };

  return {
    templateId: bestMatch.id,
    stepNumber: firstStep.stepNumber,
    status: statusMap[firstStep.stepNumber] ?? DocumentStatus.PENDING_APPROVER_1,
    approverId: approver?.id ?? firstStep.approverUserId ?? null,
    approver,
  };
}

export function resolveNextWorkflowStepForApproval(
  template: {
    id: string;
    steps: Array<{
      id: string;
      stepNumber: number;
      role: UserRole;
      approverUserId: string | null;
      approver: { id: string; email: string; name: string } | null;
    }>;
  } | null,
  currentStepNumber: number | null,
): {
  currentStep: { stepNumber: number; role: UserRole; approverUserId: string | null; approver: { id: string; email: string; name: string } | null } | null;
  nextStep: { stepNumber: number; role: UserRole; approverUserId: string | null; approver: { id: string; email: string; name: string } | null } | null;
  nextStatus: DocumentStatus | null;
} {
  if (!template || template.steps.length === 0) {
    return { currentStep: null, nextStep: null, nextStatus: null };
  }

  const orderedSteps = [...template.steps].sort((a, b) => a.stepNumber - b.stepNumber);
  const currentStep = orderedSteps.find((step) => step.stepNumber === currentStepNumber) ?? orderedSteps[0];
  const currentIndex = orderedSteps.findIndex((step) => step.stepNumber === currentStep.stepNumber);
  const nextStep = orderedSteps[currentIndex + 1] ?? null;

  const statusMap: Record<number, DocumentStatus> = {
    1: DocumentStatus.PENDING_APPROVER_1,
    2: DocumentStatus.PENDING_APPROVER_2,
    3: DocumentStatus.PENDING_APPROVER_3,
  };

  return {
    currentStep,
    nextStep,
    nextStatus: nextStep ? statusMap[nextStep.stepNumber] ?? DocumentStatus.PENDING_APPROVER_1 : DocumentStatus.APPROVED,
  };
}
