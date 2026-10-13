// src/app/api/documents/route.ts
import { DocumentStatus, ProcessStatus, ProcessStepSource } from "@prisma/client";
import { NextResponse } from "next/server";
import { deleteDocumentFiles, saveDocumentVersionFile } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { documentStorageFolder } from "@/lib/storage-layout";
import { loadFieldDefinitions, normalizeFieldValues, parseFieldInputs, saveFieldValues } from "@/lib/document-fields";
import { canUserUpload } from "@/lib/workflow/eligibility";
import { generateDocumentNumber } from "@/lib/workflow/numbering";
import { startApproval, type WorkflowEffects } from "@/lib/workflow/engine";
import { linkDocumentToCurrentStep } from "@/lib/workflow/processes";
import { dispatchWorkflowEffects } from "@/lib/workflow/effects";
import { WorkflowError } from "@/lib/workflow/errors";

export const runtime = "nodejs";

function text(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const savedPaths: string[] = [];

  try {
    const formData = await request.formData();
    const title = text(formData, "title");
    const description = text(formData, "description");
    const documentTypeId = text(formData, "documentTypeId");
    const documentSubtypeId = text(formData, "documentSubtypeId") || null;
    const projectId = text(formData, "projectId") || null;
    const processInstanceId = text(formData, "processInstanceId") || null;
    const submissionKey = text(formData, "submissionKey") || null;
    const fileTitles = formData.getAll("fileTitles").map((value) => String(value || "").trim());
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);

    if (!documentTypeId) throw new WorkflowError("Document type is required.", 400);
    if (files.length === 0) throw new WorkflowError("At least one file is required.", 400);
    if (!title && fileTitles.every((value) => !value)) {
      throw new WorkflowError("At least one document title is required.", 400);
    }

    // ---- Type, sub type and project come from the database, not from code ----
    const documentType = await prisma.documentType.findFirst({
      where: { id: documentTypeId, isActive: true },
      select: {
        id: true,
        code: true,
        supportsLineItems: true,
        subtypes: { where: { isActive: true }, select: { id: true, code: true } },
      },
    });
    if (!documentType) throw new WorkflowError("This document type is not available.", 400);

    const subtype = documentSubtypeId ? documentType.subtypes.find((candidate) => candidate.id === documentSubtypeId) : null;
    if (documentSubtypeId && !subtype) throw new WorkflowError("This sub type does not belong to the selected document type.", 400);
    if (!documentSubtypeId && documentType.subtypes.length > 0) throw new WorkflowError("Sub type is required for this document type.", 400);

    const project = projectId
      ? await prisma.project.findFirst({
          where: { id: projectId, isActive: true },
          select: { id: true, code: true, location: { select: { name: true } } },
        })
      : null;
    if (projectId && !project) throw new WorkflowError("This project is not available.", 400);

    // ---- Who may upload: the flow's uploader step (level 0), or any Clerk assigned to the project when there is no flow ----
    const actor = { id: session.userId, userType: session.userType };
    const allowed = await canUserUpload(prisma, actor, { documentTypeId, documentSubtypeId, projectId });
    if (!allowed) {
      throw new WorkflowError("You are not allowed to upload this type of document for this project.", 403);
    }

    // ---- A process step holds one document ----
    if (processInstanceId) {
      if (files.length !== 1) throw new WorkflowError("Upload one document at a time when adding to a process step.", 400);
      const run = await prisma.processInstance.findUnique({ where: { id: processInstanceId }, select: { status: true } });
      if (!run) throw new WorkflowError("Process run not found.", 404);
      if (run.status !== ProcessStatus.IN_PROGRESS) throw new WorkflowError("This process run is not in progress.", 409);
    }

    // ---- Custom fields ----
    const definitions = await loadFieldDefinitions(prisma, documentTypeId, documentSubtypeId);
    const inputs = parseFieldInputs(formData.get("fieldValues"), formData.get("lineItems"));
    const fields = normalizeFieldValues(definitions, inputs.header, inputs.lineItems, documentType.supportsLineItems);

    // ---- Repeat of an earlier submit (double click, retry): return what already exists ----
    const keys = submissionKey ? files.map((_file, index) => `${submissionKey}:${index}`) : [];
    if (keys.length > 0) {
      const existing = await prisma.document.findMany({
        where: { submissionKey: { in: keys } },
        select: { id: true, documentNumber: true, title: true, status: true },
      });
      if (existing.length > 0) {
        return NextResponse.json({ message: "Document already submitted.", documents: existing }, { status: 200 });
      }
    }

    const storageFolder = documentStorageFolder({
      locationName: project?.location?.name ?? null,
      projectCode: project?.code ?? null,
      documentTypeCode: documentType.code,
      documentSubtypeCode: subtype?.code ?? null,
    });

    const effects: WorkflowEffects = { notifications: [], emailEvents: [] };

    const created = await prisma.$transaction(
      async (tx) => {
        const results: Array<{ id: string; documentNumber: string; title: string; status: DocumentStatus }> = [];

        for (const [index, file] of files.entries()) {
          const documentNumber = await generateDocumentNumber(tx, { documentTypeId, projectId });
          const perFileTitle = fileTitles[index]?.trim() || file.name.replace(/\.[^.]+$/, "") || title || "Untitled Document";

          const document = await tx.document.create({
            data: {
              documentNumber,
              submissionKey: keys[index] ?? null,
              title: perFileTitle,
              description: description || null,
              status: DocumentStatus.PENDING,
              currentVersion: 0,
              createdById: session.userId,
              documentTypeId,
              documentSubtypeId,
              projectId,
            },
          });

          const saved = await saveDocumentVersionFile({
            documentId: document.id,
            versionNumber: 0,
            file,
            documentNumber,
            storageFolder,
          });
          savedPaths.push(saved.relativePath);

          const version = await tx.documentVersion.create({
            data: {
              documentId: document.id,
              versionNumber: 0,
              filePath: saved.relativePath,
              storageFolder: saved.storageFolder,
              originalName: file.name,
              extension: saved.extension,
              mimeType: file.type || "application/octet-stream",
              fileSize: file.size,
              uploadedById: session.userId,
            },
          });

          await saveFieldValues(tx, document.id, fields);

          // Copies the flow onto the document and starts level 1 (or approves it at once when no flow applies).
          const result = await startApproval(tx, { documentId: document.id, actor, versionId: version.id });
          effects.notifications.push(...result.effects.notifications);
          effects.emailEvents.push(...result.effects.emailEvents);

          if (processInstanceId) {
            await linkDocumentToCurrentStep(tx, {
              processInstanceId,
              documentId: document.id,
              source: ProcessStepSource.UPLOADED,
              linkedById: session.userId,
            });
          }

          results.push({ id: document.id, documentNumber, title: perFileTitle, status: result.status });
        }

        return results;
      },
      { maxWait: 10_000, timeout: 60_000 },
    );

    await dispatchWorkflowEffects(effects);

    return NextResponse.json({ message: "Document submitted.", documents: created }, { status: 201 });
  } catch (error) {
    // Do not leave files behind when the database work was rolled back.
    if (savedPaths.length > 0) {
      await deleteDocumentFiles({ filePaths: savedPaths }).catch(() => undefined);
    }

    if (error instanceof WorkflowError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to submit document." },
      { status: 500 },
    );
  }
}
