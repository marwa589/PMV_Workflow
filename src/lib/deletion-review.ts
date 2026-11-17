import "server-only";

import { DeletionRequestStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ASSIGNMENT_SCOPE_SELECT, assignmentMatchesScope, scopeToDocumentWhere, type Db } from "@/lib/auth/access";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";

const REVIEW_PERMISSION = "documents.delete_review";

type Reviewer = { userId: string; userType: UserTypeCode };

/** The documents (as a filter) whose deletion requests this person may review. Null = none at all. */
async function reviewableDocumentsWhere(user: Reviewer, db: Db): Promise<Prisma.DocumentWhereInput | null> {
  if (user.userType === USER_TYPE.ADMIN) return {};
  const assignments = await db.userAssignment.findMany({
    where: { userId: user.userId, role: { permissions: { some: { permission: { code: REVIEW_PERMISSION } } } } },
    select: ASSIGNMENT_SCOPE_SELECT,
  });
  const filters = assignments.map((assignment) => scopeToDocumentWhere(assignment)).filter((filter): filter is Prisma.DocumentWhereInput => filter !== null);
  return filters.length > 0 ? { OR: filters } : null;
}

/** Does this person review deletion requests anywhere (Admin user, or "Review deletion" in some scope)? */
export async function userCanReviewDeletions(user: Reviewer, db: Db = prisma): Promise<boolean> {
  return (await reviewableDocumentsWhere(user, db)) !== null;
}

/** Pending deletion requests this person may decide on, newest first. */
export async function getReviewableDeletionRequests(user: Reviewer, db: Db = prisma, take = 200) {
  const where = await reviewableDocumentsWhere(user, db);
  if (!where) return [];
  return db.deletionRequest.findMany({
    where: { status: DeletionRequestStatus.PENDING, document: where },
    include: {
      document: { select: { id: true, documentNumber: true, title: true } },
      requestedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Everyone who may review the deletion of this document: Admin users, and people whose "Review deletion" assignment
 * covers it. Used to tell them a request is waiting. The person who asked is left out.
 */
export async function getDeletionReviewerIds(
  documentId: string,
  exceptUserId: string | null,
  db: Db = prisma,
): Promise<string[]> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { projectId: true, documentTypeId: true, documentSubtypeId: true, project: { select: { locationId: true, companyId: true } } },
  });
  if (!document) return [];
  const scope = {
    projectId: document.projectId,
    locationId: document.project?.locationId ?? null,
    companyId: document.project?.companyId ?? null,
    documentTypeId: document.documentTypeId,
    documentSubtypeId: document.documentSubtypeId,
  };

  const [admins, holders] = await Promise.all([
    db.user.findMany({ where: { isActive: true, userType: { code: USER_TYPE.ADMIN } }, select: { id: true } }),
    db.userAssignment.findMany({
      where: { user: { isActive: true }, role: { permissions: { some: { permission: { code: REVIEW_PERMISSION } } } } },
      select: { userId: true, ...ASSIGNMENT_SCOPE_SELECT },
    }),
  ]);
  const ids = new Set(admins.map((user) => user.id));
  for (const holder of holders) if (assignmentMatchesScope(holder, scope)) ids.add(holder.userId);
  if (exceptUserId) ids.delete(exceptUserId);
  return [...ids];
}
