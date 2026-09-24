import { ApprovalActionType, DocumentStatus, ErrStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getModuleVisibility } from "@/lib/auth/module-visibility";
import { isRestrictedClerk } from "@/lib/auth/resource-access";

export async function getPurchaseOrderStatuses(documentIds: string[]) {
  if (documentIds.length === 0) return new Map<string, boolean>();
  const links = await prisma.purchaseOrderMrLink.findMany({
    where: { documentId: { in: documentIds } },
    select: { documentId: true },
  });
  return new Map(links.map((link) => [link.documentId, true]));
}

type ApproverRole = "APPROVER_1" | "APPROVER_2" | "APPROVER_3";

export type DocumentRow = {
  id: string;
  documentNumber: string;
  title: string;
  status: DocumentStatus;
  documentType: "COMPARISON" | "MATERIAL_REQUISITION";
  mrType?: "CASH" | "CREDIT" | null;
  mrNumber?: string | null;
  relatedComparison?: { documentNumber: string; title: string } | null;
  currentVersion: number;
  createdAt: Date;
  currentApprover: { name: string } | null;
};

export type ActionDocumentRow = {
  id: string;
  documentNumber: string;
  title: string;
  status: DocumentStatus;
  documentType: "COMPARISON" | "MATERIAL_REQUISITION";
  mrType?: "CASH" | "CREDIT" | null;
  mrNumber?: string | null;
  relatedComparison?: { documentNumber: string; title: string } | null;
  currentVersion: number;
  createdAt: Date;
  currentApprover: { name: string } | null;
};

export async function getDocumentsForClerk(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });

  const isRestricted = user ? isRestrictedClerk(user) : false;
  const whereClause = isRestricted ? { createdById: userId } : {};

  const [documents, total, pending, approved, rejected] = await Promise.all([
    prisma.document.findMany({
      where: whereClause,
      include: {
        createdBy: { select: { location: true } },
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          where: { action: { in: [ApprovalActionType.REJECTED, ApprovalActionType.APPROVED] } },
          orderBy: { performedAt: "desc" },
          take: 50,
          include: { performedBy: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.document.count({ where: whereClause }),
    prisma.document.count({
      where: {
        ...whereClause,
        status: { in: [DocumentStatus.PENDING_APPROVER_1, DocumentStatus.PENDING_APPROVER_2, DocumentStatus.PENDING_APPROVER_3] },
      },
    }),
    prisma.document.count({ where: { ...whereClause, status: DocumentStatus.APPROVED } }),
    prisma.document.count({ where: { ...whereClause, status: DocumentStatus.REJECTED } }),
  ]);

  return { documents, total, pending, approved, rejected};
}

export async function getDocumentsForApprover(userId: string, role: UserRole, userName: string) {
  const canQueryErrs = getModuleVisibility(userName, role) !== "DOCUMENTS_ONLY";

  const [
    pendingDocuments,
    revisionRequiredDocuments,
    approvedDocuments,
    rejectedDocuments,
    myDocuments,
    recentActivity,
    errPendingDocuments,
    errRevisionRequiredDocuments,
    errApprovedDocuments,
    errRejectedDocuments,
    errMyDocuments,
  ] = await Promise.all([
    prisma.document.findMany({
      where: {
        currentApproverId: userId,
        status: { in: [DocumentStatus.PENDING_APPROVER_1, DocumentStatus.PENDING_APPROVER_2, DocumentStatus.PENDING_APPROVER_3] },
      },
      include: {
        createdBy: { select: { location: true } },
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          orderBy: { performedAt: "desc" },
          take: 1,
          select: { comments: true, action: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.document.findMany({
      where: {
        currentApproverId: userId,
        status: DocumentStatus.REVISION_REQUIRED,
      },
      include: {
        createdBy: { select: { location: true } },
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          orderBy: { performedAt: "desc" },
          take: 1,
          select: { comments: true, action: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.document.findMany({
      where: { approvals: { some: { performedById: userId, action: ApprovalActionType.APPROVED } } },
      include: {
        createdBy: { select: { location: true } },
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          where: { action: ApprovalActionType.REJECTED },
          orderBy: { performedAt: "desc" },
          take: 1,
          include: { performedBy: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.document.findMany({
      where: { approvals: { some: { performedById: userId, action: ApprovalActionType.REJECTED } } },
      include: {
        createdBy: { select: { location: true } },
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          where: { action: ApprovalActionType.REJECTED },
          orderBy: { performedAt: "desc" },
          take: 1,
          include: { performedBy: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.document.findMany({
      where: {
        OR: [{ currentApproverId: userId }, { approvals: { some: { performedById: userId } } }],
      },
      include: {
        createdBy: { select: { location: true } },
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          where: { action: ApprovalActionType.REJECTED },
          orderBy: { performedAt: "desc" },
          take: 1,
          include: { performedBy: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.approvalHistory.findMany({
      where: { performedById: userId },
      include: { document: { select: { documentNumber: true, title: true } } },
      orderBy: { performedAt: "desc" },
      take: 8,
    }),
    canQueryErrs ? prisma.err.findMany({
      where: {
        currentApproverId: userId,
        status: ErrStatus.PENDING,
      },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApproverId: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
        files: {
          where: { kind: "QUOTATION" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { originalName: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }) : Promise.resolve([]),
    canQueryErrs ? prisma.err.findMany({
      where: {
        currentApproverId: userId,
        status: ErrStatus.REVISION_REQUIRED,
      },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApproverId: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }) : Promise.resolve([]),
    canQueryErrs ? prisma.err.findMany({
      where: {
        approvalHistory: {
          some: {
            performedById: userId,
            action: "APPROVED",
          },
        },
      },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }) : Promise.resolve([]),
    canQueryErrs ? prisma.err.findMany({
      where: {
        approvalHistory: {
          some: {
            performedById: userId,
            action: "REJECTED",
          },
        },
      },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }) : Promise.resolve([]),
    canQueryErrs ? prisma.err.findMany({
      where: {
        ...(role === UserRole.APPROVER_3
          ? {}
          : {
              OR: [
                { currentApproverId: userId },
                { approvalHistory: { some: { performedById: userId } } },
              ],
            }),
      },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApproverId: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }) : Promise.resolve([]),
  ]);

  return {
    pendingDocuments,
    revisionRequiredDocuments,
    approvedDocuments,
    rejectedDocuments,
    myDocuments,
    recentActivity,
    errPendingDocuments,
    errRevisionRequiredDocuments,
    errApprovedDocuments,
    errRejectedDocuments,
    errMyDocuments,
    role,
  };
}

export async function getDocumentsForAdmin() {
  const [
    documents,
    pendingDocuments,
    approvedDocuments,
    rejectedDocuments,
    recentActivity,
    usersByRole,
    errPendingDocuments,
    errApprovedDocuments,
    errRejectedDocuments,
    errRevisionRequiredDocuments,
    errOnHoldDocuments,
  ] = await Promise.all([
    prisma.document.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { location: true } },
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          where: { action: ApprovalActionType.REJECTED },
          orderBy: { performedAt: "desc" },
          take: 1,
          include: { performedBy: { select: { name: true } } },
        },
      },
    }),
    prisma.document.findMany({
      where: { status: { in: [DocumentStatus.PENDING_APPROVER_1, DocumentStatus.PENDING_APPROVER_2, DocumentStatus.PENDING_APPROVER_3] } },
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { location: true } },
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          where: { action: ApprovalActionType.REJECTED },
          orderBy: { performedAt: "desc" },
          take: 1,
          include: { performedBy: { select: { name: true } } },
        },
      },
    }),
    prisma.document.findMany({
      where: { status: DocumentStatus.APPROVED },
      orderBy: { createdAt: "desc" },
      include: {
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          where: { action: ApprovalActionType.REJECTED },
          orderBy: { performedAt: "desc" },
          take: 1,
          include: { performedBy: { select: { name: true } } },
        },
      },
    }),
    prisma.document.findMany({
      where: { status: DocumentStatus.REJECTED },
      orderBy: { createdAt: "desc" },
      include: {
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { id: true, documentNumber: true, title: true } },
        approvals: {
          where: { action: ApprovalActionType.REJECTED },
          orderBy: { performedAt: "desc" },
          take: 1,
          include: { performedBy: { select: { name: true } } },
        },
      },
    }),
    prisma.approvalHistory.findMany({
      include: {
        document: { select: { documentNumber: true, title: true } },
        performedBy: { select: { name: true, email: true } },
      },
      orderBy: { performedAt: "desc" },
      take: 8,
    }),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.err.findMany({
      where: { status: ErrStatus.PENDING },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.err.findMany({
      where: { status: ErrStatus.APPROVED },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.err.findMany({
      where: { status: ErrStatus.REJECTED },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.err.findMany({
      where: { status: ErrStatus.REVISION_REQUIRED },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.err.findMany({
      where: { status: ErrStatus.ON_HOLD },
      select: {
        id: true,
        documentNumber: true,
        title: true,
        status: true,
        type: true,
        currentApprover: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    documents,
    pendingDocuments,
    approvedDocuments,
    rejectedDocuments,
    recentActivity,
    usersByRole,
    errPendingDocuments,
    errApprovedDocuments,
    errRejectedDocuments,
    errRevisionRequiredDocuments,
    errOnHoldDocuments,
  };
}
