// src/app/api/documents/deletion-requests/bulk/route.ts
import { DeletionRequestStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { userHasPermissionForDocument } from "@/lib/auth/access";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { runInBackground } from "@/lib/background";
import { createNotification } from "@/lib/notifications";
import { deleteDocumentRecords } from "@/lib/document-deletion";
import { deleteDocumentFiles } from "@/lib/files";

export const runtime = "nodejs";

// Reviewing deletion requests needs the documents.delete_review permission for each document.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
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
    const pending = await prisma.deletionRequest.findMany({
      where: { id: { in: requestIds }, status: DeletionRequestStatus.PENDING },
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

    if (pending.length === 0) {
      return NextResponse.json({ message: "No pending deletion requests found for the specified IDs." }, { status: 404 });
    }

    // Only the requests this person is allowed to review.
    const requests: typeof pending = [];
    for (const item of pending) {
      if (await userHasPermissionForDocument(session, "documents.delete_review", item.document)) requests.push(item);
    }

    if (requests.length === 0) {
      return NextResponse.json({ message: "You are not allowed to review these deletion requests." }, { status: 403 });
    }

    let processedCount = 0;

    if (action === "REJECT") {
      await prisma.deletionRequest.updateMany({
        where: { id: { in: requests.map((r) => r.id) } },
        data: { status: DeletionRequestStatus.REJECTED, approverId: session.userId, reviewedAt: new Date() },
      });

      runInBackground(async () => {
        for (const item of requests) {
          await writeAuditLog({
            documentId: item.documentId,
            performedById: session.userId,
            action: "DELETION_REQUEST_REJECTED",
            details: JSON.stringify({ reviewerUserType: session.userType, requestedById: item.requestedById, bulkAction: true }),
          });
        }
      });

      processedCount = requests.length;
    } else {
      for (const item of requests) {
        try {
          const filePaths = await prisma.$transaction(async (tx) => {
            await tx.deletionRequest.update({
              where: { id: item.id },
              data: { status: DeletionRequestStatus.APPROVED, approverId: session.userId, reviewedAt: new Date() },
            });
            return deleteDocumentRecords(tx, [item.document.id]);
          });

          processedCount += 1;

          runInBackground(async () => {
            await writeAuditLog({
              documentId: item.document.id,
              performedById: session.userId,
              action: "DELETION_REQUEST_APPROVED",
              details: JSON.stringify({ reviewerUserType: session.userType, requestedById: item.requestedById, bulkAction: true }),
            });

            await Promise.all(
              [...new Set([item.requestedById, item.document.createdById])].map((userId) =>
                createNotification({
                  userId,
                  type: "DOCUMENT_DELETED",
                  title: "Document deleted",
                  message: `${item.document.documentNumber} - ${item.document.title}`,
                  documentId: item.document.id,
                }),
              ),
            );

            if (filePaths.length > 0) {
              await deleteDocumentFiles({ filePaths });
            }
          });
        } catch {
          // Continue with the other requests even if one fails.
        }
      }
    }

    return NextResponse.json(
      {
        message: action === "REJECT" ? "Deletion requests rejected." : "Deletion requests approved and documents deleted.",
        processedCount,
        skippedCount: pending.length - requests.length,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to process bulk deletion requests." },
      { status: 500 },
    );
  }
}
