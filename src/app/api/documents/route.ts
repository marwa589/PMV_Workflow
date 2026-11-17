import { ApprovalActionType, DocumentStatus, DocumentType, MrType, Prisma, UserRole, UserLocation } from "@prisma/client";
import { NextResponse } from "next/server";
import { saveDocumentVersionFile } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { queueWorkflowEmailEvents } from "@/lib/workflow-email-batching";
import { createNotification } from "@/lib/notifications";
import { runInBackground } from "@/lib/background";
import { resolveWorkflowApproverIdsForLocation, resolveWorkflowApproverIdsForUploader } from "@/lib/workflow-locations";
import { resolveDocumentWorkflowForSubmission } from "@/lib/document-workflow-config";
import { documentStorageFolder } from "@/lib/storage-layout";
import { isErroUser } from "@/lib/auth/resource-access";
import { isAvkUploaderWorkflowDocument, MARC_PMV_MANAGER_EMAIL, RAMZI_DOCUMENT_APPROVER_EMAIL } from "@/lib/mohamed-document-workflow";
import { BERNABIE_UPLOADER_EMAIL, getKsaProjectByKey, ksaProjectDirectorEmail, workflowRouteOptionsForUploader } from "@/lib/ksa-projects";

export const runtime = "nodejs";

async function nextDocumentNumber(tx: Prisma.TransactionClient): Promise<string> {
  const sequence = await tx.documentNumberSequence.upsert({
    where: { id: 1 },
    update: { lastNumber: { increment: 1 } },
    create: { id: 1, lastNumber: 1 },
    select: { lastNumber: true },
  });
  return `DOC-${String(sequence.lastNumber).padStart(4, "0")}`;
}

async function nextCustodyNumber(tx: Prisma.TransactionClient): Promise<string> {
  const sequence = await tx.custodyFileSequence.upsert({
    where: { id: 1 },
    update: { nextNumber: { increment: 1 } },
    create: { id: 1, nextNumber: 2 },
    select: { nextNumber: true },
  });
  return `C${String(sequence.nextNumber - 1).padStart(4, "0")}`;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== UserRole.CLERK && session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Only Clerk and Admin can submit documents." }, { status: 403 });
  }

  const isDispatcher = session.userId === "cmtzdt5fx000uastr7kdqoe5c" || isErroUser(session);
  // Erro and Bernabie see every approved comparison when linking one to an MR.
  const seesAllComparisons = isDispatcher || session.email?.trim().toLowerCase() === BERNABIE_UPLOADER_EMAIL;

  const formData = await request.formData();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const documentType = String(formData.get("documentType") || "").trim();
  const comparisonType = String(formData.get("comparisonType") || "").trim();
  const comparisonWorkflowLocation = String(formData.get("comparisonWorkflowLocation") || "").trim();
  const mrType = String(formData.get("mrType") || "").trim();
  const mrWorkflowLocation = String(formData.get("mrWorkflowLocation") || "").trim();
  const mrNumber = String(formData.get("mrNumber") || "").trim();
  const relatedComparisonId = String(formData.get("relatedComparisonId") || "").trim();
  const rawFiles = formData.getAll("files");
  const fileTitles = formData.getAll("fileTitles").map((value) => String(value || "").trim());
  const files = rawFiles.filter((value): value is File => value instanceof File);

  if (!title && files.length > 0 && fileTitles.every((value) => !value)) {
    return NextResponse.json({ message: "At least one document title is required." }, { status: 400 });
  }

  if (!["COMPARISON", "MATERIAL_REQUISITION", "CUSTODY"].includes(documentType)) {
    return NextResponse.json({ message: "Document type is required." }, { status: 400 });
  }

  if (documentType === "CUSTODY" && session.role !== UserRole.CLERK && session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Only AVR uploaders can submit custody files." }, { status: 403 });
  }

  if (documentType === "MATERIAL_REQUISITION" && !["CASH", "CREDIT"].includes(mrType)) {
    return NextResponse.json({ message: "MR type is required." }, { status: 400 });
  }

  if (documentType === "COMPARISON" && !["SPARE_PARTS", "OTHER"].includes(comparisonType)) {
    return NextResponse.json({ message: "Comparison type is required." }, { status: 400 });
  }

  if (files.length === 0) {
    return NextResponse.json({ message: "At least one file is required." }, { status: 400 });
  }

  if (documentType !== "MATERIAL_REQUISITION" && relatedComparisonId) {
    return NextResponse.json({ message: "Only material requisitions can link a comparison." }, { status: 400 });
  }

  const uploader = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { email: true, location: true, projectName: true },
  });

  if (!uploader) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  // Erro (AVR) and Bernabie (AVK) pick a "location / project" route for every MR and comparison:
  // their own location keeps today's flow, a KSA project (Ready Mix Khobar, WP03, Tachalih KSA) uses that project's chain.
  // Erro can also pick AVK: the document is then an AVK document (same chain as Bernabie's AVK uploads).
  const routeOptions = workflowRouteOptionsForUploader(uploader);
  const allowedRoutes = routeOptions.map((option) => option.value);
  const usesWorkflowRoutes = allowedRoutes.length > 0;
  const routeLabels = routeOptions.map((option) => option.label).join(", ");

  if (comparisonWorkflowLocation && (documentType !== "COMPARISON" || !usesWorkflowRoutes)) {
    return NextResponse.json({ message: "This comparison route is not available for your account." }, { status: 403 });
  }

  if (documentType === "COMPARISON" && usesWorkflowRoutes && !allowedRoutes.includes(comparisonWorkflowLocation)) {
    return NextResponse.json({ message: `Select one of: ${routeLabels} for this comparison.` }, { status: 400 });
  }

  if (mrWorkflowLocation && (documentType !== "MATERIAL_REQUISITION" || !usesWorkflowRoutes)) {
    return NextResponse.json({ message: "This MR route is not available for your account." }, { status: 403 });
  }

  if (documentType === "MATERIAL_REQUISITION" && usesWorkflowRoutes && !allowedRoutes.includes(mrWorkflowLocation)) {
    return NextResponse.json({ message: `Select one of: ${routeLabels} for this MR.` }, { status: 400 });
  }

  const selectedRoute = documentType === "MATERIAL_REQUISITION"
    ? mrWorkflowLocation
    : documentType === "COMPARISON"
      ? comparisonWorkflowLocation
      : "";
  const ksaProject = usesWorkflowRoutes ? getKsaProjectByKey(selectedRoute) : null;
  // Erro's AVK route: the document is stored, routed and filed as AVK although his account is AVR.
  const isErroAvkRoute = usesWorkflowRoutes && selectedRoute === UserLocation.AVK && uploader.location !== UserLocation.AVK;
  const documentLocation = isErroAvkRoute ? UserLocation.AVK : uploader.location;
  // Erro's own account project (AVR side) is not carried onto his AVK documents.
  const documentProjectName = ksaProject ? ksaProject.name : isErroAvkRoute ? null : uploader.projectName ?? null;
  const ksaProjectDirector = ksaProject ? ksaProjectDirectorEmail(ksaProject, documentType) : null;
  // Project director first (Ready Mix Khobar MRs + comparisons, WP03 MRs), then the PMV Manager.
  const isKsaDirectorWorkflow = Boolean(ksaProject && ksaProjectDirector);
  // No project director for this type: Workshop Manager (George), then the PMV Manager.
  const isKsaWorkshopWorkflow = Boolean(ksaProject && !ksaProjectDirector);
  const isKsaProjectMr = documentType === "MATERIAL_REQUISITION" && Boolean(ksaProject);
  const isAvkUploaderWorkflow = !ksaProject && isAvkUploaderWorkflowDocument(uploader.email, documentType, documentLocation);
  const isAvkMrWorkflow = isAvkUploaderWorkflow && documentType === "MATERIAL_REQUISITION";
  const isAvkComparisonWorkflow = isAvkUploaderWorkflow && documentType === "COMPARISON";

  if (documentType === "CUSTODY" && uploader.location !== UserLocation.AVR) {
    return NextResponse.json({ message: "Custody files can only be submitted by an AVR uploader." }, { status: 403 });
  }

  const configuredWorkflow = documentType === "CUSTODY" || ksaProject || isAvkUploaderWorkflow ? null : await resolveDocumentWorkflowForSubmission(prisma, {
    uploaderLocation: uploader.location,
    documentType,
    documentSubtype: documentType === "COMPARISON" ? comparisonType : mrType,
    projectName: uploader.projectName,
  });

  const mohamedPmvManager = isAvkMrWorkflow
    ? await prisma.user.findFirst({
        where: { email: MARC_PMV_MANAGER_EMAIL, role: UserRole.APPROVER_3 },
        select: { id: true },
      })
    : null;

  const workflowApprovers = isKsaDirectorWorkflow
    ? { approver1Id: null, approver2Id: null, approver3Id: null, location: documentLocation }
    : isKsaWorkshopWorkflow
      ? { ...(await resolveWorkflowApproverIdsForUploader(prisma, uploader.email)), approver1Id: null }
    : isAvkMrWorkflow
      ? { approver1Id: null, approver2Id: null, approver3Id: mohamedPmvManager?.id ?? null, location: documentLocation }
      : isAvkComparisonWorkflow
        // AVK comparison chain (PMV Engineer Joemar, Workshop Manager, PMV Manager); Erro's AVK route uses the AVK chain too.
        ? isErroAvkRoute
          ? await resolveWorkflowApproverIdsForLocation(prisma, UserLocation.AVK)
          : await resolveWorkflowApproverIdsForUploader(prisma, uploader.email)
    : configuredWorkflow
    ? { approver1Id: null, approver2Id: null, approver3Id: null, location: uploader.location }
    : await resolveWorkflowApproverIdsForUploader(prisma, uploader.email);

  const { approver1Id, approver2Id, approver3Id, location } = workflowApprovers;

  if (!location) {
    return NextResponse.json({ message: "User location is not configured for this workflow." }, { status: 400 });
  }

  const requiresApprover1 = !isKsaDirectorWorkflow && !isAvkMrWorkflow && (Boolean(configuredWorkflow?.approverId && configuredWorkflow.status === DocumentStatus.PENDING_APPROVER_1) || Boolean(approver1Id));
  const approver1 = configuredWorkflow?.status === DocumentStatus.PENDING_APPROVER_1
    ? configuredWorkflow.approver
    : approver1Id ? await prisma.user.findUnique({ where: { id: approver1Id }, select: { id: true, email: true, name: true } }) : null;
  const approver2 = configuredWorkflow?.status === DocumentStatus.PENDING_APPROVER_2
    ? configuredWorkflow.approver
    : approver2Id ? await prisma.user.findUnique({ where: { id: approver2Id }, select: { id: true, email: true, name: true } }) : null;
  const approver3 = configuredWorkflow?.status === DocumentStatus.PENDING_APPROVER_3
    ? configuredWorkflow.approver
    : approver3Id ? await prisma.user.findUnique({ where: { id: approver3Id }, select: { id: true, email: true, name: true } }) : null;

  if (requiresApprover1 && !approver1) {
    return NextResponse.json({ message: "Approver 1 account is missing for the configured location." }, { status: 400 });
  }

  const requiresApprover2 = !isKsaDirectorWorkflow && !isAvkMrWorkflow && documentType !== "CUSTODY" && (isKsaWorkshopWorkflow || configuredWorkflow?.status === DocumentStatus.PENDING_APPROVER_2 || requiresApprover1 || location === UserLocation.KUWAIT || documentType === "MATERIAL_REQUISITION" || (documentType === "COMPARISON" && comparisonType === "SPARE_PARTS"));

  if (requiresApprover2 && !approver2) {
    return NextResponse.json({ message: "Approver 2 account is missing for this workflow." }, { status: 400 });
  }

  if (!isKsaDirectorWorkflow && !approver3) {
    return NextResponse.json({ message: "PMV Manager account is missing." }, { status: 400 });
  }

  const readyMixDirector = isKsaDirectorWorkflow && ksaProjectDirector
    ? await prisma.user.findUnique({
        where: { email: ksaProjectDirector },
        select: { id: true, email: true, name: true },
      })
    : null;

  if (isKsaDirectorWorkflow && !readyMixDirector) {
    return NextResponse.json({ message: `The ${ksaProject?.name} project director account (${ksaProjectDirector}) is not available for this workflow.` }, { status: 400 });
  }

  const mohamedWorkflowApprover = isAvkMrWorkflow
    ? await prisma.user.findUnique({
        where: { email: RAMZI_DOCUMENT_APPROVER_EMAIL },
        select: { id: true, email: true, name: true },
      })
    : null;

  if (isAvkMrWorkflow && !mohamedWorkflowApprover) {
    return NextResponse.json({ message: "Ramzi Abou Chakra's account is not available for this workflow." }, { status: 400 });
  }

  if (isAvkUploaderWorkflow && approver3?.email.trim().toLowerCase() !== MARC_PMV_MANAGER_EMAIL) {
    return NextResponse.json({ message: "Marc Baddour's PMV Manager account is not available for this workflow." }, { status: 400 });
  }

  const initialApprover = isKsaDirectorWorkflow
    ? readyMixDirector
    : isAvkMrWorkflow
      ? mohamedWorkflowApprover
    : configuredWorkflow?.approverId ? configuredWorkflow.approver : requiresApprover1 ? approver1 : requiresApprover2 ? approver2 : approver3;
  const initialStatus = isKsaDirectorWorkflow
    ? DocumentStatus.PENDING_APPROVER_1
    : isAvkMrWorkflow
      ? DocumentStatus.PENDING_APPROVER_1
    : configuredWorkflow?.status ?? (requiresApprover1 ? DocumentStatus.PENDING_APPROVER_1 : requiresApprover2 ? DocumentStatus.PENDING_APPROVER_2 : DocumentStatus.PENDING_APPROVER_3);

  if (!initialApprover) {
    return NextResponse.json({ message: "Initial approver account is missing." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (relatedComparisonId) {
        const comparison = await tx.document.findFirst({
          where: {
            id: relatedComparisonId,
            documentType: DocumentType.COMPARISON,
            status: DocumentStatus.APPROVED,
          },
          select: { id: true, projectName: true },
        });
        if (!comparison) {
          throw new Error("The selected comparison is no longer available or is not approved.");
        }
        if (!seesAllComparisons && isKsaProjectMr && ksaProject && comparison.projectName !== ksaProject.name) {
          throw new Error(`${ksaProject.name} MRs can only link an approved ${ksaProject.name} comparison.`);
        }
      }

      const createdDocuments = [] as Array<{ id: string; documentNumber: string; title: string }>;

      for (const [index, file] of files.entries()) {
        const documentNumber = documentType === "CUSTODY" ? await nextCustodyNumber(tx) : await nextDocumentNumber(tx);
        const perFileTitle = fileTitles[index]?.trim() || file.name.replace(/\.[^.]+$/, "") || title || "Untitled Document";
        const normalizedDocumentType = documentType === "COMPARISON"
          ? DocumentType.COMPARISON
          : documentType === "CUSTODY"
            ? DocumentType.CUSTODY
            : DocumentType.MATERIAL_REQUISITION;
        const normalizedMrType = documentType === "MATERIAL_REQUISITION"
          ? (mrType === "CREDIT" ? MrType.CREDIT : MrType.CASH)
          : null;
        const documentData = {
          documentNumber,
          title: perFileTitle,
          description: description || null,
          status: initialStatus,
          currentVersion: 0,
          createdById: session.userId,
          lastActiveStage: initialStatus,
          currentApproverId: initialApprover.id,
          currentApproverAssignedAt: new Date(),
          uploaderLocation: documentLocation,
          projectName: documentProjectName,
          workflowTemplateId: isAvkUploaderWorkflow ? null : configuredWorkflow?.templateId ?? null,
          currentWorkflowStep: isAvkUploaderWorkflow ? null : configuredWorkflow?.stepNumber ?? null,
          documentType: normalizedDocumentType,
          comparisonType: normalizedDocumentType === DocumentType.COMPARISON ? comparisonType as "SPARE_PARTS" | "OTHER" : null,
          mrType: normalizedMrType,
          mrNumber: documentType === "MATERIAL_REQUISITION" && mrNumber ? mrNumber : null,
          ...(documentType === "MATERIAL_REQUISITION" && relatedComparisonId
            ? { relatedComparisonId }
            : {}),
        };

        const document = await tx.document.create({
          data: documentData,
        });

        const isMrLinked = normalizedDocumentType === DocumentType.MATERIAL_REQUISITION && !!relatedComparisonId;
        const storageFolder = documentStorageFolder({
          uploaderEmail: uploader.email,
          location: documentLocation,
          projectName: documentProjectName,
          documentType: normalizedDocumentType,
          mrType: normalizedMrType === MrType.CREDIT ? "CREDIT" : normalizedMrType === MrType.CASH ? "CASH" : null,
          hasLinkedComparison: isMrLinked,
        });
        const saved = await saveDocumentVersionFile({
          documentId: document.id,
          versionNumber: 0,
          file,
          documentType: normalizedDocumentType,
          documentNumber,
          mrNumber: documentType === "MATERIAL_REQUISITION" ? mrNumber || null : null,
          hasLinkedComparison: isMrLinked,
          uploaderEmail: uploader.email,
          mrType: normalizedMrType === MrType.CREDIT ? "CREDIT" : normalizedMrType === MrType.CASH ? "CASH" : null,
          projectName: documentProjectName,
          storageFolder,
        });

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

        await tx.approvalHistory.create({
          data: {
            documentId: document.id,
            versionId: version.id,
            action: ApprovalActionType.SUBMITTED,
            comments: description || "Submitted by Clerk",
            performedById: session.userId,
          },
        });

        createdDocuments.push({ id: document.id, documentNumber: document.documentNumber, title: perFileTitle });
      }

      return createdDocuments;
    });

    await queueWorkflowEmailEvents(
      result.map((document) => ({
        recipientId: initialApprover.id,
        type: "APPROVAL_PENDING" as const,
        documentId: document.id,
      })),
    );

    runInBackground(async () => {
      await Promise.all(result.map((document) => createNotification({
        userId: initialApprover.id,
        type: "PENDING_APPROVAL",
        title: "Document awaiting your review",
        message: `${document.documentNumber} - ${document.title}`,
        documentId: document.id,
      })));
    });

    return NextResponse.json({ message: "Document submitted.", documents: result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Failed to submit document.",
      },
      { status: 500 },
    );
  }
}
