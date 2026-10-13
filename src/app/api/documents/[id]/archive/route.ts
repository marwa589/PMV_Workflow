// src/app/api/documents/[id]/archive/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { userHasPermissionForDocument } from "@/lib/auth/access";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { setDocumentArchived } from "@/lib/workflow/engine";
import { WorkflowError } from "@/lib/workflow/errors";

export const runtime = "nodejs";

// Archive (body { "archived": true }) or restore ({ "archived": false }) one document.
// Needs the documents.archive permission for that document. Only approved or rejected documents can be archived.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { archived?: unknown } | null;
  if (typeof body?.archived !== "boolean") {
    return NextResponse.json({ message: "archived must be true or false." }, { status: 400 });
  }

  const document = await prisma.document.findUnique({
    where: { id },
    select: { id: true, projectId: true, documentTypeId: true, documentSubtypeId: true, project: { select: { locationId: true } } },
  });
  if (!document) return NextResponse.json({ message: "Document not found." }, { status: 404 });

  if (!(await userHasPermissionForDocument(session, "documents.archive", document))) {
    return NextResponse.json({ message: "You are not allowed to archive this document." }, { status: 403 });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      setDocumentArchived(tx, { documentId: id, actor: { id: session.userId, userType: session.userType }, archived: body.archived as boolean }),
    );

    await writeAuditLog({
      documentId: id,
      performedById: session.userId,
      action: body.archived ? "DOCUMENT_ARCHIVED" : "DOCUMENT_RESTORED",
      details: JSON.stringify({ status: result.status }),
    });

    return NextResponse.json({ message: body.archived ? "Document archived." : "Document restored.", status: result.status });
  } catch (error) {
    if (error instanceof WorkflowError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Unable to update the document." }, { status: 500 });
  }
}
