import { DeletionRequestStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== UserRole.CLERK) {
    return NextResponse.json({ message: "Only Clerk can request document deletion." }, { status: 403 });
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

  for (const documentId of ids) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true },
    });

    if (!document) {
      continue;
    }

    const pendingRequest = await prisma.deletionRequest.findFirst({
      where: {
        documentId: document.id,
        status: DeletionRequestStatus.PENDING,
      },
      select: { id: true },
    });

    if (pendingRequest) {
      continue;
    }

    await prisma.deletionRequest.create({
      data: {
        documentId: document.id,
        requestedById: session.userId,
        reason: "Clerk requested deletion",
      },
    });

    await writeAuditLog({
      documentId: document.id,
      performedById: session.userId,
      action: "DELETION_REQUESTED",
      details: JSON.stringify({ requestedByRole: session.role, documentId: document.id }),
    });

    createdCount += 1;
  }

  return NextResponse.json(
    {
      message: createdCount > 0
        ? "Deletion request sent to Admin. The documents will be deleted after approval."
        : "Deletion requests already exist for the selected documents.",
      createdCount,
    },
    { status: 200 },
  );
}
