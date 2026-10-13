// src/app/api/documents/deletion-requests/[id]/route.ts
import { DeletionRequestStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { userHasPermissionForDocument } from "@/lib/auth/access";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit";
import { runInBackground } from "@/lib/background";
import { deleteDocumentRecords } from "@/lib/document-deletion";
import { deleteDocumentFiles } from "@/lib/files";

export const runtime = "nodejs";

// Reviewing a deletion request needs the documents.delete_review permission for that document.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const formData = await request.formData();
  const decision = String(formData.get("decision") || "").trim().toUpperCase();

  if (decision !== "APPROVE" && decision !== "REJECT") {
    return NextResponse.json({ message: "Decision must be APPROVE or REJECT." }, { status: 400 });
  }

  const requestRecord = await prisma.deletionRequest.findUnique({
    where: { id },
    include: {
      document: {
        select: {
          id: true,
          documentNumber: true,
          title: true,
          createdById: true,
          projectId: true,
          documentTypeId: true,
          documentSubtypeId: true,
          project: { select: { locationId: true } },
        },
      },
    },
  });

  if (!requestRecord) {
    return NextResponse.json({ message: "Deletion request not found." }, { status: 404 });
  }

  if (!(await userHasPermissionForDocument(session, "documents.delete_review", requestRecord.document))) {
    return NextResponse.json({ message: "You are not allowed to review deletion requests for this document." }, { status: 403 });
  }

  if (requestRecord.status !== DeletionRequestStatus.PENDING) {
    return NextResponse.json({ message: "Deletion request already processed." }, { status: 400 });
  }

  if (decision === "REJECT") {
    await prisma.deletionRequest.update({
      where: { id },
      data: { status: DeletionRequestStatus.REJECTED, approverId: session.userId, reviewedAt: new Date() },
    });

    await writeAuditLog({
      documentId: requestRecord.documentId,
      performedById: session.userId,
      action: "DELETION_REQUEST_REJECTED",
      details: JSON.stringify({ decision, reviewerUserType: session.userType, requestedById: requestRecord.requestedById }),
    });

    return NextResponse.json({ message: "Deletion request rejected." }, { status: 200 });
  }

  const document = requestRecord.document;

  const filePaths = await prisma.$transaction(async (tx) => {
    await tx.deletionRequest.update({
      where: { id },
      data: { status: DeletionRequestStatus.APPROVED, approverId: session.userId, reviewedAt: new Date() },
    });
    return deleteDocumentRecords(tx, [document.id]);
  });

  await writeAuditLog({
    documentId: document.id,
    performedById: session.userId,
    action: "DELETION_REQUEST_APPROVED",
    details: JSON.stringify({ decision, reviewerUserType: session.userType, requestedById: requestRecord.requestedById }),
  });

  const notifyUsers = new Set<string>([requestRecord.requestedById, document.createdById]);

  runInBackground(async () => {
    await Promise.all(
      [...notifyUsers].map((userId) =>
        createNotification({
          userId,
          type: "DOCUMENT_DELETED",
          title: "Document deleted",
          message: `${document.documentNumber} - ${document.title}`,
          documentId: document.id,
        }),
      ),
    );
  });

  if (filePaths.length > 0) {
    await deleteDocumentFiles({ filePaths });
  }

  return NextResponse.json({ message: "Document deleted after approval." }, { status: 200 });
}
