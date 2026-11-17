// src/app/api/documents/route.ts
import { DocumentStatus, ProcessStatus, ProcessStepSource } from "@prisma/client";
import { NextResponse } from "next/server";
import { deleteDocumentFiles, saveDocumentVersionFile } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { canAccessDocument } from "@/lib/auth/access";
import { USER_TYPE } from "@/lib/auth/roles";
import { resolveFlow } from "@/lib/workflow/resolve-flow";
import { prisma } from "@/lib/prisma";
import { documentStorageFolder } from "@/lib/storage-layout";
import { loadFieldDefinitions, normalizeFieldValues, parseFieldInputs, saveFieldValues, type NormalizedFields } from "@/lib/document-fields";
import { canUserUpload } from "@/lib/workflow/eligibility";
import { generateDocumentNumber } from "@/lib/workflow/numbering";
import { registerApprovedDocument, startApproval, type WorkflowEffects } from "@/lib/workflow/engine";
import { writeAuditLog } from "@/lib/audit";
import { addDocumentToCompletedRun, classifyUpload, linkDocumentToStep, nodeMatches, reconcileProcessRun, startFollowUpRun, startProcessRun } from "@/lib/workflow/processes";
import { dispatchWorkflowEffects } from "@/lib/workflow/effects";
import { userCanBulkApprove } from "@/lib/bulk-approve";
import { notifyProcessFollowers } from "@/lib/workflow/mail-follow";
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
    // Admin only: the document is already approved (no approval flow), optionally with the date it was approved on;
    // `notify` tells the people who may upload the next process document; `startProcessDefinitionId` names the
    // process the admin is starting on purpose with this (root) document.
    const alreadyApproved = text(formData, "alreadyApproved") === "true";
    // Optional: the uploader ticked one of the unique tracks of the flow's uploader level.
    const trackSortOrderText = text(formData, "trackSortOrder");
    const trackSortOrder = trackSortOrderText === "" ? null : Number(trackSortOrderText);
    if (trackSortOrder !== null && (!Number.isInteger(trackSortOrder) || trackSortOrder < 0)) {
      throw new WorkflowError("Choose a valid unique track.", 400);
    }
    if (trackSortOrder !== null && alreadyApproved) {
      throw new WorkflowError("A unique track cannot be used when the document is saved as already approved.", 400);
    }
    const approvedAtInput = text(formData, "approvedAt");
    const notifyNext = text(formData, "notify") === "true";
    const startProcessDefinitionId = text(formData, "startProcessDefinitionId") || null;
    const fileTitles = formData.getAll("fileTitles").map((value) => String(value || "").trim());
    // Each file's own description; a file without one takes the shared description.
    const fileDescriptions = formData.getAll("fileDescriptions").map((value) => String(value ?? "").trim());
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);

    if (!documentTypeId) throw new WorkflowError("Document type is required.", 400);
    if (files.length === 0) throw new WorkflowError("At least one file is required.", 400);

    // ---- Uploading the next document of a running process: the person chose one of the open child nodes ----
    // (The first document of a process, its root, needs no run: the run starts by itself further down.)
    let processRun: { id: string; projectId: string | null; currentStepId: string | null } | null = null;
    let processStep: { id: string; documentTypeId: string; documentSubtypeId: string | null; allowMultipleUploads: boolean } | null = null;
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
        select: { id: true, documentTypeId: true, documentSubtypeId: true, allowMultipleUploads: true },
      });
      if (!processStep) throw new WorkflowError("That is not one of the options for the next step of this process.", 400);
      if (!nodeMatches(processStep, { documentTypeId, documentSubtypeId })) {
        throw new WorkflowError("This document is not the type the chosen step asks for.", 400);
      }
      if (run.projectId !== projectId) throw new WorkflowError("The project must be the one the process run belongs to.", 400);
      processRun = run;
    }
    const continuingExistingProcess = Boolean(processStep);
    // "Allow multiple uploads" is set up on the process step (off by default). When it is on, every file becomes its
    // own follow-up run, linked to the run and the approved document it follows. Open to everyone who may upload.
    const allowMultiple = Boolean(processStep?.allowMultipleUploads);

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

    // ---- Documents outside every process tree upload on their own; a root starts a run; later nodes need a linked document ----
    const upload = processStep ? null : await classifyUpload(prisma, { documentTypeId, documentSubtypeId });
    // ---- Where each file goes in a process ----
    // Task path (My Tasks / "Upload" button): every file goes to the chosen run and step.
    // New Document, a document that is a LATER node of a process tree: every file must name the document it follows
    // (linkedKey_<n> = "runId|stepId" for a run that is waiting, "runId|stepId|approvedDocumentId" for a completed run).
    // Root documents start their own run and documents outside every tree upload on their own: no link is needed.
    type LinkTarget = { mode: "continue" | "addition"; runId: string; stepId: string; parentDocumentId: string | null; allowMultiple: boolean; projectId: string | null };
    const linkTargets: Array<LinkTarget | null> = files.map(() => null);
    if (processRun && processStep) {
      const taskTarget: LinkTarget = { mode: "continue", runId: processRun.id, stepId: processStep.id, parentDocumentId: null, allowMultiple, projectId: processRun.projectId };
      files.forEach((_file, index) => {
        linkTargets[index] = taskTarget;
      });
    } else if (upload?.kind === "task-only") {
      const resolved = new Map<string, LinkTarget>();
      for (const [index, file] of files.entries()) {
        const label = files.length > 1 ? ` for ${file.name}` : "";
        const key = text(formData, `linkedKey_${index}`);
        // The linked document is optional for now: without one the file is uploaded on its own (no process link).
        if (!key) continue;
        const known = resolved.get(key);
        if (known) {
          linkTargets[index] = known;
          continue;
        }
        const [runId, stepId, parentDocumentId] = key.split("|");
        if (!runId || !stepId) throw new WorkflowError(`The linked document${label} is not valid.`, 400);

        const run = await prisma.processInstance.findUnique({
          where: { id: runId },
          select: { id: true, status: true, projectId: true, currentStepId: true, processDefinitionId: true, stepVersion: true },
        });
        if (!run) throw new WorkflowError(`The process of the linked document${label} was not found.`, 404);
        const step = await prisma.processStep.findFirst({
          where: { id: stepId, processDefinitionId: run.processDefinitionId, versionNumber: run.stepVersion, parentStepId: { not: null } },
          select: { id: true, documentTypeId: true, documentSubtypeId: true, parentStepId: true, allowMultipleUploads: true },
        });
        if (!step) throw new WorkflowError(`The linked document${label} does not lead to this type of document.`, 400);
        if (!nodeMatches(step, { documentTypeId, documentSubtypeId })) {
          throw new WorkflowError(`This document is not the type that follows the linked document${label}.`, 400);
        }

        let target: LinkTarget;
        if (run.status === ProcessStatus.IN_PROGRESS) {
          if (!run.currentStepId || run.currentStepId !== step.parentStepId) {
            throw new WorkflowError(`The process of the linked document${label} is not waiting for this document.`, 409);
          }
          target = { mode: "continue", runId: run.id, stepId: step.id, parentDocumentId: null, allowMultiple: step.allowMultipleUploads, projectId: run.projectId };
        } else if (run.status === ProcessStatus.COMPLETED) {
          if (!parentDocumentId) throw new WorkflowError(`The linked document${label} is not valid.`, 400);
          target = { mode: "addition", runId: run.id, stepId: step.id, parentDocumentId, allowMultiple: false, projectId: run.projectId };
        } else {
          throw new WorkflowError(`The process of the linked document${label} was cancelled.`, 409);
        }
        resolved.set(key, target);
        linkTargets[index] = target;
      }
    }

    // ---- The project of each file ----
    // A file that follows a linked document gets the project of that document, so one upload can hold files of
    // several projects. Every other file gets the project chosen on the form.
    const fileProjectIds: Array<string | null> = files.map((_file, index) => linkTargets[index]?.projectId ?? projectId);
    const linkedProjectIds = new Set(linkTargets.flatMap((target) => (target && !processStep ? [target.projectId ?? ""] : [])));
    type ProjectInfo = { id: string; code: string; location: { name: string } | null };
    const projectsById = new Map<string, ProjectInfo>();
    for (const id of new Set(fileProjectIds.filter((value): value is string => Boolean(value)))) {
      // Only a project chosen on the form must be active; a linked document keeps the project of its process.
      const needsActive = !continuingExistingProcess && !linkedProjectIds.has(id) && id === projectId;
      const found = await prisma.project.findFirst({
        where: { id, ...(needsActive ? { isActive: true } : {}) },
        select: { id: true, code: true, location: { select: { name: true } } },
      });
      if (!found) throw new WorkflowError("This project is not available.", 400);
      projectsById.set(id, found);
    }
    const projectOf = (id: string | null) => (id ? projectsById.get(id) ?? null : null);

    // ---- Admin only: already approved documents, and starting a process on purpose ----
    const isAdmin = session.userType === USER_TYPE.ADMIN;
    if ((alreadyApproved || startProcessDefinitionId) && !isAdmin) {
      throw new WorkflowError("Only an Admin user can upload an already approved document or start a process by hand.", 403);
    }
    let approvedAt: Date | null = null;
    if (alreadyApproved && approvedAtInput) {
      const today = new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(approvedAtInput) || Number.isNaN(new Date(`${approvedAtInput}T12:00:00Z`).getTime())) {
        throw new WorkflowError("The approval date is not a valid date.", 400);
      }
      if (approvedAtInput > today) throw new WorkflowError("The approval date cannot be in the future.", 400);
      // Noon UTC keeps the calendar day the same in every time zone; today's date means "now".
      approvedAt = approvedAtInput === today ? new Date() : new Date(`${approvedAtInput}T12:00:00Z`);
    }
    if (startProcessDefinitionId) {
      if (processStep) throw new WorkflowError("A process that is already running cannot be started again.", 400);
      if (upload?.kind !== "root" || upload.processDefinitionId !== startProcessDefinitionId) {
        throw new WorkflowError("This document is not the starting document of the chosen process.", 400);
      }
    }

    // ---- Who may upload: the flow's uploader step (level 0), or any Clerk assigned to the project when there is no flow ----
    const actor = { id: session.userId, userType: session.userType };
    for (const uploadProjectId of new Set(fileProjectIds)) {
      const allowed = await canUserUpload(prisma, actor, { documentTypeId, documentSubtypeId, projectId: uploadProjectId });
      if (!allowed) {
        const projectName = projectOf(uploadProjectId)?.code;
        throw new WorkflowError(`You are not allowed to upload this type of document for ${projectName ? `project ${projectName}` : "this project"}.`, 403);
      }
    }

    // ---- A process step holds one document, unless "allow multiple uploads" gives each file its own follow-up run ----
    if (processInstanceId && !allowMultiple && files.length !== 1) {
      throw new WorkflowError("Upload one document at a time when adding to this process step.", 400);
    }

    // ---- Optional reference document (only the uploader of a step can attach one, and only now) ----
    // It is either a new file of the step's reference type (that type must need no approval), or an already
    // approved document the uploader picks. It is never approved and only people with "View reference documents" see it.
    // Each uploaded file may carry any number of reference documents (no setting needed: they are not part of the
    // run). Fields are numbered by the file's position and the reference's position: referenceCount_0 and then
    // referenceFile_0_0, referenceTitle_0_0, referenceDocumentId_0_1, referenceSubtypeId_0_1, ...
    type ReferenceInput = {
      existingDocumentId: string | null;
      file: File | null;
      title: string;
      type: { id: string; code: string };
      subtype: { id: string; code: string } | null;
    };
    const references: ReferenceInput[][] = files.map(() => []);

    const MAX_REFERENCES_PER_FILE = 20;
    const referenceCount = (index: number) => {
      const count = Number(formData.get(`referenceCount_${index}`) || 0);
      return Number.isInteger(count) && count > 0 ? Math.min(count, MAX_REFERENCES_PER_FILE) : 0;
    };
    const field = (name: string, index: number, position: number) => formData.get(`${name}_${index}_${position}`);
    const wantsReference = files.some((_file, index) =>
      Array.from({ length: referenceCount(index) }, (_unused, position) => position).some((position) => {
        const candidate = field("referenceFile", index, position);
        return (candidate instanceof File && candidate.size > 0) || String(field("referenceDocumentId", index, position) || "").trim() !== "";
      }),
    );

    if (wantsReference) {
      // The reference setting belongs to the step each file fills (or to the start document of the process).
      const stepConfigs = new Map<
        string,
        { referenceDocumentTypeId: string | null; referenceDocumentSubtypeId: string | null; referenceDocumentType: { id: string; code: string; subtypes: Array<{ id: string; code: string }> } | null } | null
      >();
      const loadStepConfig = async (stepId: string | null) => {
        if (!stepId) return null;
        if (!stepConfigs.has(stepId)) {
          stepConfigs.set(
            stepId,
            await prisma.processStep.findUnique({
              where: { id: stepId },
              select: {
                referenceDocumentTypeId: true,
                referenceDocumentSubtypeId: true,
                referenceDocumentType: { select: { id: true, code: true, subtypes: { select: { id: true, code: true } } } },
              },
            }),
          );
        }
        return stepConfigs.get(stepId) ?? null;
      };

      // Whether a NEW file of this type would need approval (then only an approved document can be picked).
      const approvalCache = new Map<string, boolean>();
      const needsApprovalFor = async (referenceTypeId: string, subtypeId: string | null, forProjectId: string | null) => {
        const key = `${referenceTypeId}|${subtypeId ?? ""}|${forProjectId ?? ""}`;
        const cached = approvalCache.get(key);
        if (cached !== undefined) return cached;
        const flow = await resolveFlow(prisma, { documentTypeId: referenceTypeId, documentSubtypeId: subtypeId, projectId: forProjectId });
        const result = flow.kind === "flow" && flow.template.steps.some((step) => step.stepNumber > 0);
        approvalCache.set(key, result);
        return result;
      };

      for (const [index, file] of files.entries()) {
       const stepConfig = await loadStepConfig(linkTargets[index]?.stepId ?? (upload?.kind === "root" ? upload.rootStepId : null));
       for (let position = 0; position < referenceCount(index); position += 1) {
        const label = files.length > 1 ? ` (file ${index + 1}: ${file.name})` : "";
        const rawFile = field("referenceFile", index, position);
        const referenceUpload = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;
        const referenceDocumentId = String(field("referenceDocumentId", index, position) || "").trim() || null;
        if (!referenceUpload && !referenceDocumentId) continue;
        if (!stepConfig?.referenceDocumentType) {
          throw new WorkflowError(`This step does not take a reference document${label}.`, 400);
        }
        const refType = stepConfig.referenceDocumentType;
        if (referenceUpload && referenceDocumentId) {
          throw new WorkflowError(`Attach either a new reference file or an existing approved document, not both${label}.`, 400);
        }

        const refSubtypeId = stepConfig.referenceDocumentSubtypeId ?? (String(field("referenceSubtypeId", index, position) || "").trim() || null);
        const refSubtype = refSubtypeId ? refType.subtypes.find((candidate) => candidate.id === refSubtypeId) ?? null : null;
        if (refSubtypeId && !refSubtype) throw new WorkflowError(`The reference sub type does not belong to the reference document type${label}.`, 400);
        if (!refSubtype && refType.subtypes.length > 0 && !referenceDocumentId) {
          throw new WorkflowError(`Choose the sub type of the reference document${label}.`, 400);
        }

        if (referenceDocumentId) {
          const existingRef = await prisma.document.findUnique({
            where: { id: referenceDocumentId },
            select: { id: true, status: true, isReference: true, documentTypeId: true, documentSubtypeId: true },
          });
          if (!existingRef || existingRef.isReference || !(await canAccessDocument(session, existingRef.id))) {
            throw new WorkflowError(`That reference document is not available${label}.`, 400);
          }
          if (existingRef.status !== DocumentStatus.APPROVED) throw new WorkflowError(`Only an approved document can be used as a reference${label}.`, 400);
          if (!nodeMatches({ documentTypeId: stepConfig.referenceDocumentTypeId!, documentSubtypeId: stepConfig.referenceDocumentSubtypeId }, existingRef)) {
            throw new WorkflowError(`That document is not the type this step asks for as a reference${label}.`, 400);
          }
          if (references[index].some((item) => item.existingDocumentId === existingRef.id)) continue;
          references[index].push({ existingDocumentId: existingRef.id, file: null, title: "", type: refType, subtype: refSubtype });
        } else {
          if (await needsApprovalFor(refType.id, refSubtype?.id ?? null, fileProjectIds[index])) {
            throw new WorkflowError("This reference document type goes through approval, so a new file cannot be uploaded as a reference. Pick an already approved document instead.", 400);
          }
          references[index].push({
            existingDocumentId: null,
            file: referenceUpload,
            title: String(field("referenceTitle", index, position) || "").trim(),
            type: refType,
            subtype: refSubtype,
          });
        }
       }
      }
    }

    // ---- Custom fields ----
    const definitions = await loadFieldDefinitions(prisma, documentTypeId, documentSubtypeId);
    // Every file is its own document. A file may carry its own values (fieldValues_0, lineItems_0, ... by position,
    // sent when the uploader confirmed values read from that file); a file without them gets the shared values.
    let sharedFields: NormalizedFields | null = null;
    const getSharedFields = () => {
      if (!sharedFields) {
        const inputs = parseFieldInputs(formData.get("fieldValues"), formData.get("lineItems"));
        sharedFields = normalizeFieldValues(definitions, inputs.header, inputs.lineItems, documentType.supportsLineItems);
      }
      return sharedFields;
    };
    const fieldsPerFile: NormalizedFields[] = files.map((file, index) => {
      const ownHeader = formData.get(`fieldValues_${index}`);
      const ownLines = formData.get(`lineItems_${index}`);
      if (ownHeader === null && ownLines === null) return getSharedFields();
      try {
        const own = parseFieldInputs(ownHeader, ownLines);
        return normalizeFieldValues(definitions, own.header, own.lineItems, documentType.supportsLineItems);
      } catch (error) {
        if (error instanceof WorkflowError && files.length > 1) throw new WorkflowError(`${file.name}: ${error.message}`, error.status);
        throw error;
      }
    });

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

    const storageFolderOf = (id: string | null) =>
      documentStorageFolder({
        locationName: projectOf(id)?.location?.name ?? null,
        projectCode: projectOf(id)?.code ?? null,
        documentTypeCode: documentType.code,
        documentSubtypeCode: subtype?.code ?? null,
      });

    const effects: WorkflowEffects = { notifications: [], emailEvents: [] };
    // An already approved admin upload does not announce "next document ready" unless the admin asked for it.
    const linkEffects: WorkflowEffects = alreadyApproved && !notifyNext ? { notifications: [], emailEvents: [] } : effects;
    let processRunId: string | null = linkTargets.find((target) => target !== null)?.runId ?? null;
    const followUpRunIds: string[] = [];
    // Documents whose first level is the uploader's own and needs their signature: the browser opens them for signing.
    const signNow: string[] = [];

    const created = await prisma.$transaction(
      async (tx) => {
        const results: Array<{ id: string; documentNumber: string; title: string; status: DocumentStatus }> = [];
        const startedRuns = new Set<string>();
        const deferredLinks: Array<{ runId: string; stepId: string; documentId: string; referenceDocumentIds: string[] }> = [];

        for (const [index, file] of files.entries()) {
          const fileProjectId = fileProjectIds[index];
          const storageFolder = storageFolderOf(fileProjectId);
          const documentNumber = await generateDocumentNumber(tx, { documentTypeId, documentSubtypeId, projectId: fileProjectId });
          const perFileTitle = fileTitles[index]?.trim() || file.name.replace(/\.[^.]+$/, "") || "Untitled Document";
          const perFileDescription = index < fileDescriptions.length ? fileDescriptions[index] : description;

          const document = await tx.document.create({
            data: {
              documentNumber,
              submissionKey: keys[index] ?? null,
              title: perFileTitle,
              description: perFileDescription || null,
              status: DocumentStatus.PENDING,
              currentVersion: 0,
              createdById: session.userId,
              documentTypeId,
              documentSubtypeId,
              projectId: fileProjectId,
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

          await saveFieldValues(tx, document.id, fieldsPerFile[index]);

          // Copies the flow onto the document and starts level 1 (or approves it at once when no flow applies).
          // An Admin user may instead register the document as already approved.
          const result = alreadyApproved
            ? await registerApprovedDocument(tx, { documentId: document.id, actor, versionId: version.id, approvedAt })
            : await startApproval(tx, { documentId: document.id, actor, versionId: version.id, trackSortOrder });
          effects.notifications.push(...result.effects.notifications);
          effects.emailEvents.push(...result.effects.emailEvents);
          if (result.uploaderShouldSign) signNow.push(document.id);

          // The optional reference document: stored, never approved, hidden from people without the permission.
          const referenceIds: string[] = [];
          for (const reference of references[index] ?? []) {
            let referenceDocumentLinkId: string | null = reference.existingDocumentId;
            if (reference.file) {
              const refNumber = await generateDocumentNumber(tx, { documentTypeId: reference.type.id, documentSubtypeId: reference.subtype?.id ?? null, projectId: fileProjectId });
              const refTitle = reference.title || reference.file.name.replace(/\.[^.]+$/, "") || "Reference document";
              const refDocument = await tx.document.create({
                data: {
                  documentNumber: refNumber,
                  title: refTitle,
                  description: `Reference document for ${documentNumber}`,
                  status: DocumentStatus.PENDING,
                  currentVersion: 0,
                  createdById: session.userId,
                  documentTypeId: reference.type.id,
                  documentSubtypeId: reference.subtype?.id ?? null,
                  projectId: fileProjectId,
                  isReference: true,
                },
              });
              const refSaved = await saveDocumentVersionFile({
                documentId: refDocument.id,
                versionNumber: 0,
                file: reference.file,
                documentNumber: refNumber,
                storageFolder: documentStorageFolder({
                  locationName: projectOf(fileProjectId)?.location?.name ?? null,
                  projectCode: projectOf(fileProjectId)?.code ?? null,
                  documentTypeCode: reference.type.code,
                  documentSubtypeCode: reference.subtype?.code ?? null,
                }),
              });
              savedPaths.push(refSaved.relativePath);
              const refVersion = await tx.documentVersion.create({
                data: {
                  documentId: refDocument.id,
                  versionNumber: 0,
                  filePath: refSaved.relativePath,
                  storageFolder: refSaved.storageFolder,
                  originalName: reference.file.name,
                  extension: refSaved.extension,
                  mimeType: reference.file.type || "application/octet-stream",
                  fileSize: reference.file.size,
                  uploadedById: session.userId,
                },
              });
              // No approval flow applies (checked above), so this approves it at once without telling anyone.
              await startApproval(tx, { documentId: refDocument.id, actor, versionId: refVersion.id });
              referenceDocumentLinkId = refDocument.id;
            }
            if (referenceDocumentLinkId) referenceIds.push(referenceDocumentLinkId);
          }

          const target = linkTargets[index];
          if (target?.mode === "addition" && target.parentDocumentId) {
            // The process is already completed: the document joins the same group, the run does not move.
            await addDocumentToCompletedRun(tx, {
              processInstanceId: target.runId,
              stepId: target.stepId,
              parentDocumentId: target.parentDocumentId,
              documentId: document.id,
              linkedById: session.userId,
              referenceDocumentIds: referenceIds,
            });
          } else if (target) {
            // Next document of a running process: it fills the child node that was chosen.
            // With multiple uploads the FIRST file of a run and step fills that run itself (so it no longer waits
            // for a document), and every further file gets a follow-up run of its own. The original run's link is
            // made after the loop: linking it first would fill the choice (and could advance the run), and the
            // follow-ups could no longer start from the approved document the run was waiting after.
            const targetKey = `${target.runId}|${target.stepId}`;
            if (target.allowMultiple && !startedRuns.has(targetKey)) {
              startedRuns.add(targetKey);
              deferredLinks.push({ runId: target.runId, stepId: target.stepId, documentId: document.id, referenceDocumentIds: referenceIds });
            } else {
              const targetRunId = target.allowMultiple
                ? (await startFollowUpRun(tx, { parentInstanceId: target.runId, stepId: target.stepId, reference: documentNumber, startedById: session.userId })).id
                : target.runId;
              if (target.allowMultiple) followUpRunIds.push(targetRunId);
              await linkDocumentToStep(tx, {
                processInstanceId: targetRunId,
                stepId: target.stepId,
                documentId: document.id,
                source: ProcessStepSource.UPLOADED,
                linkedById: session.userId,
                referenceDocumentIds: referenceIds,
                overrideDelay: session.userType === USER_TYPE.ADMIN,
              }, linkEffects);
            }
          } else if (upload?.kind === "root") {
            // A root document starts its process by itself; the run is named after the document number.
            const run = await startProcessRun(tx, {
              rootStepId: upload.rootStepId,
              processDefinitionId: upload.processDefinitionId,
              projectId: fileProjectId,
              reference: documentNumber,
              startedById: session.userId,
            });
            processRunId = run.id;
            await linkDocumentToStep(tx, {
              processInstanceId: run.id,
              stepId: upload.rootStepId,
              documentId: document.id,
              source: ProcessStepSource.UPLOADED,
              linkedById: session.userId,
              referenceDocumentIds: referenceIds,
            }, linkEffects);
          }

          results.push({ id: document.id, documentNumber, title: perFileTitle, status: result.status });
        }

        for (const link of deferredLinks) {
          await linkDocumentToStep(tx, {
            processInstanceId: link.runId,
            stepId: link.stepId,
            documentId: link.documentId,
            source: ProcessStepSource.UPLOADED,
            linkedById: session.userId,
            referenceDocumentIds: link.referenceDocumentIds,
            overrideDelay: session.userType === USER_TYPE.ADMIN,
          }, linkEffects);
        }

        // Safety net: every run this upload touched must stand where its documents say. A document that was approved
        // while it was being linked must never leave its run behind.
        const touchedRuns = new Set<string>(followUpRunIds);
        for (const target of linkTargets) if (target?.mode === "continue") touchedRuns.add(target.runId);
        if (processRunId) touchedRuns.add(processRunId);
        for (const runId of touchedRuns) await reconcileProcessRun(tx, runId, linkEffects);

        // Follow-up rules (Mailing List page): people following the document types of this process are told about the
        // new document once it sits in its run. A document that is approved already (no approval flow applies, or an
        // Admin user registered it as approved) counts as approved too.
        for (const result of results) {
          await notifyProcessFollowers(tx, result.id, "UPLOADED", linkEffects, [session.userId]);
          if (result.status === DocumentStatus.APPROVED) await notifyProcessFollowers(tx, result.id, "APPROVED", linkEffects, [session.userId]);
        }

        return results;
      },
      { maxWait: 10_000, timeout: 60_000 },
    );

    await dispatchWorkflowEffects(effects);

    if (alreadyApproved) {
      for (const document of created) {
        await writeAuditLog({
          documentId: document.id,
          performedById: session.userId,
          action: "DOCUMENT_UPLOADED_APPROVED",
          details: `${document.documentNumber} uploaded as already approved${approvedAt ? ` (approval date ${approvedAt.toISOString().slice(0, 10)})` : ""}${processRunId ? " into a process run" : ""}.`,
        }).catch(() => undefined);
      }
    }

    // Where the uploader signs: the review page for one document; several together when they may review several at
    // once, otherwise My Tasks (where they all wait for them).
    const signUrl =
      signNow.length === 0
        ? null
        : signNow.length === 1
          ? `/approver/review/${signNow[0]}`
          : (await userCanBulkApprove(session.userId))
            ? `/approver/review-batch?ids=${signNow.join(",")}`
            : "/tasks";

    return NextResponse.json({ message: "Document submitted.", documents: created, processRunId, followUpRunIds, signUrl }, { status: 201 });
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
