// src/app/api/sidebar-counts/route.ts
import { DocumentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { USER_TYPE } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import { getActionableDocuments } from "@/lib/document-queries";
import { getGlobalPermissionCodes } from "@/lib/auth/access";
import { canUserUploadAnything } from "@/lib/workflow/eligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TypeCount = { documentTypeId: string; code: string; name: string; count: number };

/**
 * Counts for the sidebar badges:
 *  - Admin: every document that is pending
 *  - Clerk: their own pending documents
 *  - Anyone else: documents waiting for them to act
 * `pendingByType` replaces the old hard-coded materialRequisitions / comparisons / errs counters.
 * `canUpload` says whether to show the "New document" entry.
 * `documentTypes` is the list the sidebar shows (one entry per active type); `manage` says which
 * administration screens the person may open.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { pendingApprovals: 0, pendingByType: [], canUpload: false, documentTypes: [], manage: {} },
      { status: 401 },
    );
  }

  let pendingByType: TypeCount[] = [];

  if (session.userType === USER_TYPE.ADMIN || session.userType === USER_TYPE.CLERK) {
    const grouped = await prisma.document.groupBy({
      by: ["documentTypeId"],
      where: {
        status: DocumentStatus.PENDING,
        ...(session.userType === USER_TYPE.CLERK ? { createdById: session.userId } : {}),
      },
      _count: { _all: true },
    });
    const types = await prisma.documentType.findMany({
      where: { id: { in: grouped.map((row) => row.documentTypeId) } },
      select: { id: true, code: true, name: true },
    });
    const typeById = new Map(types.map((type) => [type.id, type]));
    pendingByType = grouped.map((row) => ({
      documentTypeId: row.documentTypeId,
      code: typeById.get(row.documentTypeId)?.code ?? "",
      name: typeById.get(row.documentTypeId)?.name ?? "",
      count: row._count._all,
    }));
  } else {
    const documents = await getActionableDocuments(session, [DocumentStatus.PENDING]);
    const counts = new Map<string, TypeCount>();
    for (const document of documents) {
      const entry = counts.get(document.documentType.id) ?? {
        documentTypeId: document.documentType.id,
        code: document.documentType.code,
        name: document.documentType.name,
        count: 0,
      };
      entry.count += 1;
      counts.set(document.documentType.id, entry);
    }
    pendingByType = [...counts.values()];
  }

  const canUpload = await canUserUploadAnything(prisma, { id: session.userId, userType: session.userType });

  const [documentTypes, permissionCodes] = await Promise.all([
    prisma.documentType.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    getGlobalPermissionCodes(session),
  ]);
  const has = (code: string) => permissionCodes.includes(code);

  return NextResponse.json({
    pendingApprovals: pendingByType.reduce((sum, row) => sum + row.count, 0),
    pendingByType,
    canUpload,
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
