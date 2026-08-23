import { DeletionRequestStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { runInBackground } from "@/lib/background";
import { createNotification } from "@/lib/notifications";
import { deleteDocumentFiles } from "@/lib/files";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Only Admin can process deletion requests." }, { status: 403 });
  }

  const body = (await request.json()) as { requestIds: string[]; action: string };
  const { requestIds, action } = body;

  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    return NextResponse.json({ message: "No deletion requests specified." }, { status: 400 });
  }

  if (action !== "APPROVE" && action !== "REJECT") {
    return NextResponse.json({ message: "Action must be APPROVE or REJECT." }, { status: 400 });
  }

  try {
    const requests = await prisma.deletionRequest.findMany({
      where: {
        id: { in: requestIds },
        status: DeletionRequestStatus.PENDING,
      },
      include: {
        document: { select: { id: true, documentNumber: true, title: true, mrNumber: true, documentType: true, versions: { select: { filePath: true } }, linkedMRs: { select: { mrNumber: true } } } },
      },
    });

    if (requests.length === 0) {
      return NextResponse.json({ message: "No pending deletion requests found for the specified IDs." }, { status: 404 });
    }

    let processedCount = 0;

    if (action === "REJECT") {
      await prisma.deletionRequest.updateMany({
        where: { id: { in: requests.map((r) => r.id) } },
        data: {
          status: DeletionRequestStatus.REJECTED,
          adminReviewerId: session.userId,
          reviewedAt: new Date(),
        },
      });

      runInBackground(async () => {
        for (const request of requests) {
          await writeAuditLog({
            documentId: request.documentId,
            performedById: session.userId,
            action: "DELETION_REQUEST_REJECTED",
            details: JSON.stringify({ approverRole: session.role, requestedById: request.requestedById, bulkAction: true }),
          });
        }
      });

      processedCount = requests.length;
    } else {
      const deletedRequests = [];

      for (const req of requests) {
        try {
          await prisma.$transaction(async (tx) => {
            await tx.deletionRequest.update({
              where: { id: req.id },
              data: {
                status: DeletionRequestStatus.APPROVED,
                adminReviewerId: session.userId,
                reviewedAt: new Date(),
              },
            });

            await tx.approvalHistory.deleteMany({ where: { documentId: req.document.id } });
            await tx.emailNotificationEvent.deleteMany({ where: { documentId: req.document.id } });
            await tx.notification.deleteMany({ where: { documentId: req.document.id } });
            await tx.documentVersion.deleteMany({ where: { documentId: req.document.id } });
            await tx.document.delete({ where: { id: req.document.id } });
          });

          deletedRequests.push(req);
          processedCount += 1;

          runInBackground(async () => {
            await writeAuditLog({
              documentId: req.document.id,
              performedById: session.userId,
              action: "DELETION_REQUEST_APPROVED",
              details: JSON.stringify({ approverRole: session.role, requestedById: req.requestedById, bulkAction: true }),
            });

            const notifyUsers = new Set<string>([req.requestedById]);
            if (req.documentId) {
              const owner = await prisma.document.findUnique({
                where: { id: req.document.id },
                select: { createdById: true },
              });
              if (owner && owner.createdById) {
                notifyUsers.add(owner.createdById);
              }
            }

            await Promise.all(
              [...notifyUsers].map(async (userId) => {
                await createNotification({
                  userId,
                  type: "DOCUMENT_DELETED",
                  title: "Document deleted",
                  message: `${req.document.documentNumber} - ${req.document.title}`,
                  documentId: req.document.id,
                });
              }),
            );

            if (req.document.versions.length > 0 || req.document.linkedMRs.some((mr) => Boolean(mr.mrNumber))) {
              const filePaths = req.document.versions.map((version) => version.filePath);
              const directoryPaths = [
                ...(req.document.mrNumber && req.document.documentType === "MATERIAL_REQUISITION" ? [`MRs+Comparisons/MR-${req.document.mrNumber}`] : []),
                ...req.document.linkedMRs
                  .filter((mr) => Boolean(mr.mrNumber))
                  .map((mr) => `MRs+Comparisons/MR-${mr.mrNumber}`),
              ];
              await deleteDocumentFiles({ filePaths, directoryPaths });
            }
          });
        } catch {
          // Continue with other requests even if one fails
        }
      }
    }

    return NextResponse.json(
      {
        message: action === "REJECT" ? "Deletion requests rejected." : "Deletion requests approved and documents deleted.",
        processedCount,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Failed to process bulk deletion requests.",
      },
      { status: 500 },
    );
  }
}
