// src/app/api/documents/deletion-requests/route.ts
import { DeletionRequestStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { userHasPermissionForDocument } from "@/lib/auth/access";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { runInBackground } from "@/lib/background";
import { createNotification } from "@/lib/notifications";
import { getDeletionReviewerIds } from "@/lib/deletion-review";

export const runtime = "nodejs";

// Asking for a document to be deleted needs the documents.delete_request permission for that document.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let payload: { ids?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
  }

  const ids = Array.isArray(payload.ids)
    ? payload.ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ message: "No documents selected." }, { status: 400 });
  }

  let createdCount = 0;
  let notAllowedCount = 0;

  for (const documentId of ids) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, documentNumber: true, title: true, projectId: true, documentTypeId: true, documentSubtypeId: true },
    });

    if (!document) {
      continue;
    }

    if (!(await userHasPermissionForDocument(session, "documents.delete_request", document))) {
      notAllowedCount += 1;
      continue;
    }

    const pendingRequest = await prisma.deletionRequest.findFirst({
      where: { documentId: document.id, status: DeletionRequestStatus.PENDING },
      select: { id: true },
    });

    if (pendingRequest) {
      continue;
    }

    await prisma.deletionRequest.create({
      data: {
        documentId: document.id,
        requestedById: session.userId,
        reason: "Deletion requested",
      },
    });

    await writeAuditLog({
      documentId: document.id,
      performedById: session.userId,
      action: "DELETION_REQUESTED",
      details: JSON.stringify({ requestedByUserType: session.userType, documentId: document.id }),
    });

    // Tell the people who may decide (Admin users and "Review deletion" holders covering the document).
    const reviewerIds = await getDeletionReviewerIds(document.id, session.userId);
    runInBackground(async () => {
      await Promise.all(reviewerIds.map((userId) => createNotification({
        userId,
        type: "DELETION_REQUESTED",
        title: "Deletion requested",
        message: `${document.documentNumber} - ${document.title}`,
        documentId: document.id,
      })));
    });

    createdCount += 1;
  }

  if (createdCount === 0 && notAllowedCount > 0) {
    return NextResponse.json({ message: "You are not allowed to request deletion of the selected documents.", createdCount, notAllowedCount }, { status: 403 });
  }

  return NextResponse.json(
    {
      message: createdCount > 0
        ? "Deletion request sent for review. The documents will be deleted after approval."
        : "Deletion requests already exist for the selected documents.",
      createdCount,
      notAllowedCount,
    },
    { status: 200 },
  );
}
