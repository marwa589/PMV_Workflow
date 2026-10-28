// src/app/api/sidebar-counts/route.ts
import { DocumentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { USER_TYPE } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { getActionableDocuments } from "@/lib/document-queries";
import { buildDocumentVisibilityWhere, getGlobalPermissionCodes } from "@/lib/auth/access";
import { canUserUploadAnything } from "@/lib/workflow/eligibility";
import { getUploadTasks } from "@/lib/workflow/processes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TypeCount = { documentTypeId: string; code: string; name: string; count: number };

/**
 * Document counts follow the same visibility rules as the document lists.
 * Pending approvals remain limited to documents the user can act on.
 * `pendingByType` replaces the old hard-coded materialRequisitions / comparisons / errs counters.
 * `canUpload` says whether to show the "New document" entry.
 * `documentTypes` contains active types represented in visible documents or directly assigned to the user;
 * `manage` says which administration screens the person may open.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { pendingDocuments: 0, pendingApprovals: 0, tasks: { uploads: 0, reviews: 0 }, pendingByType: [], canUpload: false, documentTypes: [], manage: {} },
      { status: 401 },
    );
  }

  const visibility = await buildDocumentVisibilityWhere(session);
  const [grouped, documentTypes] = await Promise.all([
    prisma.document.groupBy({
      by: ["documentTypeId"],
      where: { AND: [visibility, { status: DocumentStatus.PENDING }] },
      _count: { _all: true },
    }),
    prisma.documentType.findMany({
      where: {
        isActive: true,
        ...(session.userType === USER_TYPE.ADMIN
          ? {}
          : {
              OR: [
                { documents: { some: visibility } },
                {
                  scopedAssignments: {
                    some: {
                      userId: session.userId,
                      companyId: null,
                      processDefinitionId: null,
                      documentTypeId: { not: null },
                      role: { permissions: { some: { permission: { code: "documents.view" } } } },
                    },
                  },
                },
                {
                  assignmentScopes: {
                    some: {
                      assignment: {
                        userId: session.userId,
                        companyId: null,
                        processDefinitionId: null,
                        processScopes: { none: {} },
                        role: { permissions: { some: { permission: { code: "documents.view" } } } },
                      },
                    },
                  },
                },
              ],
            }),
      },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const typeById = new Map(documentTypes.map((type) => [type.id, type]));
  const pendingByType: TypeCount[] = grouped.flatMap((row) => {
    const type = typeById.get(row.documentTypeId);
    return type
      ? [{ documentTypeId: type.id, code: type.code, name: type.name, count: row._count._all }]
      : [];
  });
  const pendingDocuments = grouped.reduce((sum, row) => sum + row._count._all, 0);

  const pendingApprovals =
    session.userType === USER_TYPE.ADMIN
      ? pendingDocuments
      : session.userType === USER_TYPE.CLERK
        ? 0
        : (await getActionableDocuments(session, [DocumentStatus.PENDING])).length;

  // My Tasks: documents to upload (next document of a running process) and documents to review.
  const [uploadTasks, reviewTasks] = await Promise.all([
    getUploadTasks(prisma, session),
    getActionableDocuments(session, [DocumentStatus.PENDING, DocumentStatus.ON_HOLD, DocumentStatus.REVISION_REQUIRED]),
  ]);

  const canUpload = await canUserUploadAnything(prisma, { id: session.userId, userType: session.userType });

  const permissionCodes = await getGlobalPermissionCodes(session);
  const has = (code: string) => permissionCodes.includes(code);

  // Process Runs is only for admins; everyone else sees linked documents on the document page.
  const canViewProcesses = session.userType === USER_TYPE.ADMIN;

  return NextResponse.json({
    pendingDocuments,
    pendingApprovals,
    tasks: { uploads: uploadTasks.length, reviews: reviewTasks.length },
    pendingByType,
    canUpload,
    canViewProcesses,
    documentTypes,
    manage: {
      flows: has("flows.manage"),
      types: has("types.manage"),
      processes: has("processes.manage"),
      users: has("users.manage"),
      assignments: has("assignments.manage"),
      delegations: has("delegations.manage"),
      projects: has("projects.manage"),
      deletionReview: has("documents.delete_review"),
    },
  });
}
