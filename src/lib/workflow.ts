import { DocumentStatus, UserRole } from "@prisma/client";

type ApproverRole = "APPROVER_1" | "APPROVER_2" | "APPROVER_3";

export const APPROVER_WORKFLOW: Record<
  ApproverRole,
  {
    expectedStatus: DocumentStatus;
    nextStatus: DocumentStatus;
    nextApproverRole: UserRole | null;
  }
> = {
  [UserRole.APPROVER_1]: {
    expectedStatus: DocumentStatus.PENDING_APPROVER_1,
    nextStatus: DocumentStatus.PENDING_APPROVER_2,
    nextApproverRole: UserRole.APPROVER_2,
  },
  [UserRole.APPROVER_2]: {
    expectedStatus: DocumentStatus.PENDING_APPROVER_2,
    nextStatus: DocumentStatus.PENDING_APPROVER_3,
    nextApproverRole: UserRole.APPROVER_3,
  },
  [UserRole.APPROVER_3]: {
    expectedStatus: DocumentStatus.PENDING_APPROVER_3,
    nextStatus: DocumentStatus.APPROVED,
    nextApproverRole: null,
  },
};

export function isApproverRole(
  role: UserRole,
): role is ApproverRole {
  return role === UserRole.APPROVER_1 || role === UserRole.APPROVER_2 || role === UserRole.APPROVER_3;
}

export function statusLabel(status: DocumentStatus): string {
  switch (status) {
    case DocumentStatus.PENDING_APPROVER_1:
      return "Pending Approval 1";
    case DocumentStatus.PENDING_APPROVER_2:
      return "Pending Approval 2";
    case DocumentStatus.PENDING_APPROVER_3:
      return "Pending Approval 3";
    case DocumentStatus.APPROVED:
      return "Approved";
    case DocumentStatus.REJECTED:
      return "Rejected";
    case DocumentStatus.REVISION_REQUIRED:
      return "Revision Required";
    default:
      return status;
  }
}
