// src/app/api/documents/[id]/received/route.ts
import { DocumentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { userHasPermissionForDocument } from "@/lib/auth/access";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

// Confirms that an approved document (for example a purchase order) has been received.
// Needs the documents.confirm_receipt permission for that document's type and project.
// Replaces the old purchase-order "received" route that only one named person could use.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      receivedAt: true,
      receivedBy: { select: { name: true, email: true } },
      projectId: true,
      documentTypeId: true,
      documentSubtypeId: true,
      project: { select: { locationId: true } },
    },
  });
  if (!document) return NextResponse.json({ message: "Document not found." }, { status: 404 });

  if (!(await userHasPermissionForDocument(session, "documents.confirm_receipt", document))) {
    return NextResponse.json({ message: "You are not allowed to confirm receipt of this document." }, { status: 403 });
  }

  // Already confirmed: return the existing confirmation.
  if (document.receivedAt && document.receivedBy) {
    return NextResponse.json({
      receivedAt: document.receivedAt.toISOString(),
      receivedByName: document.receivedBy.name,
      receivedByEmail: document.receivedBy.email,
    });
  }

  if (document.status !== DocumentStatus.APPROVED) {
    return NextResponse.json({ message: "Only an approved document can be marked as received." }, { status: 409 });
  }

  const updated = await prisma.document.update({
    where: { id },
    data: { receivedAt: new Date(), receivedById: session.userId },
    select: { receivedAt: true, receivedBy: { select: { name: true, email: true } } },
  });

  await writeAuditLog({
    documentId: id,
    performedById: session.userId,
    action: "DOCUMENT_RECEIVED",
    details: JSON.stringify({ userType: session.userType }),
  });

  return NextResponse.json({
    receivedAt: updated.receivedAt?.toISOString(),
    receivedByName: updated.receivedBy?.name,
    receivedByEmail: updated.receivedBy?.email,
  });
}
