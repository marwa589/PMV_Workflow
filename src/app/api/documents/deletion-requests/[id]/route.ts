import { DeletionRequestStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit";
import { runInBackground } from "@/lib/background";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Only Admin can approve deletion requests." }, { status: 403 });
  }

  const { id } = await params;
  const formData = await request.formData();
  const decision = String(formData.get("decision") || "").trim().toUpperCase();

  if (decision !== "APPROVE" && decision !== "REJECT") {
    return NextResponse.json({ message: "Decision must be APPROVE or REJECT." }, { status: 400 });
  }

  const requestRecord = await prisma.deletionRequest.findUnique({
    where: { id },
    include: { document: { select: { id: true, documentNumber: true, title: true, mrNumber: true, documentType: true, versions: { select: { filePath: true } }, linkedMRs: { select: { mrNumber: true } } } } },
  });

  if (!requestRecord) {
    return NextResponse.json({ message: "Deletion request not found." }, { status: 404 });
  }

  if (requestRecord.status !== DeletionRequestStatus.PENDING) {
    return NextResponse.json({ message: "Deletion request already processed." }, { status: 400 });
  }

  if (decision === "REJECT") {
    await prisma.deletionRequest.update({
      where: { id },
      data: {
        status: DeletionRequestStatus.REJECTED,
        adminReviewerId: session.userId,
        reviewedAt: new Date(),
      },
    });

    await writeAuditLog({
      documentId: requestRecord.documentId,
      performedById: session.userId,
      action: "DELETION_REQUEST_REJECTED",
      details: JSON.stringify({ decision, approverRole: session.role, requestedById: requestRecord.requestedById }),
    });

    return NextResponse.json({ message: "Deletion request rejected." }, { status: 200 });
  }

  const document = requestRecord.document;
  const filePaths = document.versions.map((version) => version.filePath);
  const directoryPaths = [
    ...(document.mrNumber && document.documentType === "MATERIAL_REQUISITION" ? [`MRs+Comparisons/MR-${document.mrNumber}`] : []),
    ...document.linkedMRs
      .filter((mr) => Boolean(mr.mrNumber))
      .map((mr) => `MRs+Comparisons/MR-${mr.mrNumber}`),
  ];

  await prisma.$transaction(async (tx) => {
    await tx.deletionRequest.update({
      where: { id },
      data: {
        status: DeletionRequestStatus.APPROVED,
        adminReviewerId: session.userId,
        reviewedAt: new Date(),
      },
    });
    await tx.approvalHistory.deleteMany({ where: { documentId: document.id } });
    await tx.emailNotificationEvent.deleteMany({ where: { documentId: document.id } });
    await tx.notification.deleteMany({ where: { documentId: document.id } });
    await tx.documentVersion.deleteMany({ where: { documentId: document.id } });
    await tx.document.delete({ where: { id: document.id } });
  });

  await writeAuditLog({
    documentId: document.id,
    performedById: session.userId,
    action: "DELETION_REQUEST_APPROVED",
    details: JSON.stringify({ decision, approverRole: session.role, requestedById: requestRecord.requestedById }),
  });

  const notifyUsers = new Set<string>();
  notifyUsers.add(requestRecord.requestedById);
  if (requestRecord.documentId) {
    const owner = await prisma.document.findUnique({
      where: { id: document.id },
      select: { createdById: true },
    });
    if (owner && owner.createdById) {
      notifyUsers.add(owner.createdById);
    }
  }

  runInBackground(async () => {
    await Promise.all(
      [...notifyUsers].map(async (userId) => {
        await createNotification({
          userId,
          type: "DOCUMENT_DELETED",
          title: "Document deleted",
          message: `${document.documentNumber} - ${document.title}`,
          documentId: document.id,
        });
      }),
    );
  });

  if (filePaths.length > 0 || directoryPaths.length > 0) {
    const { deleteDocumentFiles } = await import("@/lib/files");
    await deleteDocumentFiles({ filePaths, directoryPaths });
  }

  return NextResponse.json({ message: "Document deleted after Admin approval." }, { status: 200 });
}
