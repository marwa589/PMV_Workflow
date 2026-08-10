import { ApprovalActionType, DocumentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
  const [documents, total, pending, approved, rejected] = await Promise.all([
    prisma.document.findMany({
      where: { createdById: userId },
      include: {
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { documentNumber: true, title: true } },
        approvals: {
          where: { action: ApprovalActionType.REJECTED },
          orderBy: { performedAt: "desc" },
          take: 1,
          include: { performedBy: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.document.count({ where: { createdById: userId } }),
    prisma.document.count({
      where: {
        createdById: userId,
        status: { in: [DocumentStatus.PENDING_APPROVER_1, DocumentStatus.PENDING_APPROVER_2, DocumentStatus.PENDING_APPROVER_3] },
      },
    }),
    prisma.document.count({ where: { createdById: userId, status: DocumentStatus.APPROVED } }),
    prisma.document.count({ where: { createdById: userId, status: DocumentStatus.REJECTED } }),
  ]);

  return { documents, total, pending, approved, rejected };
}

export async function getDocumentsForApprover(userId: string, role: UserRole) {
  const [pendingDocuments, approvedDocuments, rejectedDocuments, myDocuments, recentActivity] = await Promise.all([
    prisma.document.findMany({
      where: { currentApproverId: userId },
      include: {
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { documentNumber: true, title: true } },
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
      where: { approvals: { some: { performedById: userId, action: ApprovalActionType.APPROVED } } },
      include: {
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { documentNumber: true, title: true } },
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
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { documentNumber: true, title: true } },
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
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { documentNumber: true, title: true } },
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
  ]);

  return { pendingDocuments, approvedDocuments, rejectedDocuments, myDocuments, recentActivity, role };
}

export async function getDocumentsForAdmin() {
  const [documents, pendingDocuments, approvedDocuments, rejectedDocuments, recentActivity, usersByRole] = await Promise.all([
    prisma.document.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { documentNumber: true, title: true } },
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
        currentApprover: { select: { name: true } },
        relatedComparison: { select: { documentNumber: true, title: true } },
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
        relatedComparison: { select: { documentNumber: true, title: true } },
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
        relatedComparison: { select: { documentNumber: true, title: true } },
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
  ]);

  return { documents, pendingDocuments, approvedDocuments, rejectedDocuments, recentActivity, usersByRole };
}
