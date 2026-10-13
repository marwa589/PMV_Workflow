// src/app/api/processes/[id]/link/route.ts
import { ProcessStepSource } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canAccessDocument, userHasPermission } from "@/lib/auth/access";
import { validateCsrf } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { linkDocumentToCurrentStep } from "@/lib/workflow/processes";
import { WorkflowError } from "@/lib/workflow/errors";

export const runtime = "nodejs";

// Put a document that is already in the system into the run's current step.
// (A new upload for the step goes through POST /api/documents with processInstanceId.)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { documentId?: unknown } | null;
  const documentId = typeof body?.documentId === "string" ? body.documentId.trim() : "";
  if (!documentId) return NextResponse.json({ message: "Choose a document." }, { status: 400 });

  const run = await prisma.processInstance.findUnique({
    where: { id },
    select: { startedById: true, processDefinitionId: true, projectId: true, project: { select: { locationId: true } } },
  });
  if (!run) return NextResponse.json({ message: "Process run not found." }, { status: 404 });

  const mayLink =
    run.startedById === session.userId ||
    (await userHasPermission(session, "processes.start", {
      processDefinitionId: run.processDefinitionId,
      projectId: run.projectId,
      locationId: run.project?.locationId ?? null,
    }));
  if (!mayLink) return NextResponse.json({ message: "You are not allowed to add documents to this process run." }, { status: 403 });

  if (!(await canAccessDocument(session, documentId))) {
    return NextResponse.json({ message: "You cannot use this document." }, { status: 403 });
  }

  try {
    await prisma.$transaction((tx) =>
      linkDocumentToCurrentStep(tx, { processInstanceId: id, documentId, source: ProcessStepSource.EXISTING, linkedById: session.userId }),
    );
    return NextResponse.json({ message: "Document added to the process step." }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkflowError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Unable to add the document." }, { status: 500 });
  }
}
