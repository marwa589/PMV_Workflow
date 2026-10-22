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
import { classifyUpload, linkDocumentToStep, nodeMatches, startProcessRun } from "@/lib/workflow/processes";
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

    // ---- Uploading the next document of a running process: the person chose one of the open child nodes ----
    // (The first document of a process, its root, needs no run: the run starts by itself further down.)
    let processRun: { id: string; projectId: string | null; currentStepId: string | null } | null = null;
    let processStep: { id: string; documentTypeId: string; documentSubtypeId: string | null } | null = null;
    if (processInstanceId) {
      const run = await prisma.processInstance.findUnique({
        where: { id: processInstanceId },
        select: { id: true, status: true, projectId: true, currentStepId: true, processDefinitionId: true },
      });
      if (!run) throw new WorkflowError("Process run not found.", 404);
      if (run.status !== ProcessStatus.IN_PROGRESS) throw new WorkflowError("This process run is not in progress.", 409);
      if (!run.currentStepId) throw new WorkflowError("This process is still waiting for its first document to be approved.", 409);

      const processStepId = text(formData, "processStepId");
      if (!processStepId) throw new WorkflowError("Choose which document to upload next.", 400);
      processStep = await prisma.processStep.findFirst({
        where: { id: processStepId, processDefinitionId: run.processDefinitionId, parentStepId: run.currentStepId },
        select: { id: true, documentTypeId: true, documentSubtypeId: true },
      });
      if (!processStep) throw new WorkflowError("That is not one of the options for the next step of this process.", 400);
      if (!nodeMatches(processStep, { documentTypeId, documentSubtypeId })) {
        throw new WorkflowError("This document is not the type the chosen step asks for.", 400);
      }
      if (run.projectId !== projectId) throw new WorkflowError("The project must be the one the process run belongs to.", 400);
      processRun = run;
    }
    const continuingExistingProcess = Boolean(processStep);

    // ---- Type, sub type and project come from the database, not from code ----
    const documentType = await prisma.documentType.findFirst({
      where: { id: documentTypeId, ...(continuingExistingProcess ? {} : { isActive: true }) },
      select: {
        id: true,
        code: true,
        supportsLineItems: true,
        subtypes: { select: { id: true, code: true, isActive: true } },
      },
    });
    if (!documentType) throw new WorkflowError("This document type is not available.", 400);

    const subtype = documentSubtypeId ? documentType.subtypes.find((candidate) => candidate.id === documentSubtypeId) : null;
    if (documentSubtypeId && !subtype) throw new WorkflowError("This sub type does not belong to the selected document type.", 400);
    if (documentSubtypeId && subtype && !subtype.isActive && !continuingExistingProcess) {
      throw new WorkflowError("This sub type is not available.", 400);
    }
    if (!documentSubtypeId && documentType.subtypes.length > 0) throw new WorkflowError("Sub type is required for this document type.", 400);

    const project = projectId
      ? await prisma.project.findFirst({
          where: { id: projectId, ...(continuingExistingProcess ? {} : { isActive: true }) },
          select: { id: true, code: true, location: { select: { name: true } } },
        })
      : null;
    if (projectId && !project) throw new WorkflowError("This project is not available.", 400);

    // ---- Documents outside every process tree upload on their own; a root starts a run; later nodes are task-only ----
    const upload = processStep ? null : await classifyUpload(prisma, { documentTypeId, documentSubtypeId });
    if (upload?.kind === "task-only") {
      throw new WorkflowError(
        "This type of document can only be uploaded as the next step of a running process. Open My Tasks and choose it under Document upload.",
        400,
      );
    }

    // ---- Who may upload: the flow's uploader step (level 0), or any Clerk assigned to the project when there is no flow ----
    const actor = { id: session.userId, userType: session.userType };
    const allowed = await canUserUpload(prisma, actor, { documentTypeId, documentSubtypeId, projectId });
    if (!allowed) {
      throw new WorkflowError("You are not allowed to upload this type of document for this project.", 403);
    }

    // ---- A process step holds one document ----
    if (processInstanceId && files.length !== 1) {
      throw new WorkflowError("Upload one document at a time when adding to a process step.", 400);
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
          const documentNumber = await generateDocumentNumber(tx, { documentTypeId, documentSubtypeId, projectId });
          const perFileTitle = fileTitles[index]?.trim() || file.name.replace(/\.[^.]+$/, "") || "Untitled Document";

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

          if (processRun && processStep) {
            // Next document of a running process: it fills the child node the uploader chose.
            await linkDocumentToStep(tx, {
              processInstanceId: processRun.id,
              stepId: processStep.id,
              documentId: document.id,
              source: ProcessStepSource.UPLOADED,
              linkedById: session.userId,
            }, effects);
          } else if (upload?.kind === "root") {
            // A root document starts its process by itself; the run is named after the document number.
            const run = await startProcessRun(tx, {
              rootStepId: upload.rootStepId,
              processDefinitionId: upload.processDefinitionId,
              projectId,
              reference: documentNumber,
              startedById: session.userId,
            });
            await linkDocumentToStep(tx, {
              processInstanceId: run.id,
              stepId: upload.rootStepId,
              documentId: document.id,
              source: ProcessStepSource.UPLOADED,
              linkedById: session.userId,
            }, effects);
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
