import { ApprovalActionType, DocumentStatus, DocumentType, MrType, Prisma, UserRole, UserLocation } from "@prisma/client";
import { NextResponse } from "next/server";
import { saveDocumentVersionFile } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { queueWorkflowEmailEvents } from "@/lib/workflow-email-batching";
import { resolveWorkflowApproverIdsForUploader } from "@/lib/workflow-locations";
import { resolveDocumentWorkflowForSubmission } from "@/lib/document-workflow-config";
import { documentStorageFolder } from "@/lib/storage-layout";

export const runtime = "nodejs";

async function nextDocumentNumber(tx: Prisma.TransactionClient): Promise<string> {
  const latest = await tx.document.findFirst({
    orderBy: { createdAt: "desc" },
    select: { documentNumber: true },
  });

  const latestNumber = latest?.documentNumber.match(/DOC-(\d+)/)?.[1];
  const current = latestNumber ? Number.parseInt(latestNumber, 10) : 0;
  const next = current + 1;
  return `DOC-${String(next).padStart(4, "0")}`;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== UserRole.CLERK && session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Only Clerk and Admin can submit documents." }, { status: 403 });
  }

  const formData = await request.formData();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const documentType = String(formData.get("documentType") || "").trim();
  const comparisonType = String(formData.get("comparisonType") || "").trim();
  const mrType = String(formData.get("mrType") || "").trim();
  const mrNumber = String(formData.get("mrNumber") || "").trim();
  const relatedComparisonId = String(formData.get("relatedComparisonId") || "").trim();
  const rawFiles = formData.getAll("files");
  const fileTitles = formData.getAll("fileTitles").map((value) => String(value || "").trim());
  const files = rawFiles.filter((value): value is File => value instanceof File);

  if (!title && files.length > 0 && fileTitles.every((value) => !value)) {
    return NextResponse.json({ message: "At least one document title is required." }, { status: 400 });
  }

  if (!["COMPARISON", "MATERIAL_REQUISITION"].includes(documentType)) {
    return NextResponse.json({ message: "Document type is required." }, { status: 400 });
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

  const configuredWorkflow = await resolveDocumentWorkflowForSubmission(prisma, {
    uploaderLocation: uploader.location,
    documentType,
    documentSubtype: documentType === "COMPARISON" ? comparisonType : mrType,
    projectName: uploader.projectName,
  });

  const workflowApprovers = configuredWorkflow
    ? { approver1Id: null, approver2Id: null, approver3Id: null, location: uploader.location }
    : await resolveWorkflowApproverIdsForUploader(prisma, uploader.email);

  const { approver1Id, approver2Id, approver3Id, location } = workflowApprovers;

  if (!location) {
    return NextResponse.json({ message: "User location is not configured for this workflow." }, { status: 400 });
  }

  const requiresApprover1 = Boolean(configuredWorkflow?.approverId && configuredWorkflow.status === DocumentStatus.PENDING_APPROVER_1) || Boolean(approver1Id);
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

  const requiresApprover2 = configuredWorkflow?.status === DocumentStatus.PENDING_APPROVER_2 || requiresApprover1 || location === UserLocation.KUWAIT || documentType === "MATERIAL_REQUISITION" || (documentType === "COMPARISON" && comparisonType === "SPARE_PARTS");

  if (requiresApprover2 && !approver2) {
    return NextResponse.json({ message: "Approver 2 account is missing for this workflow." }, { status: 400 });
  }

  if (!approver3) {
    return NextResponse.json({ message: "PMV Manager account is missing." }, { status: 400 });
  }

<<<<<<< HEAD
  // MRS ALSO APPROVER 2
  const requiresApprover2 = documentType ==='MATERIAL_REQUISITION' || (documentType === "COMPARISON" && comparisonType === "SPARE_PARTS");
  const initialApprover = requiresApprover2 ? approver2 : approver3;

  if (!initialApprover) {
    return NextResponse.json({ message: requiresApprover2 ? "Workshop Manager account is missing for Spare Parts comparisons." : "PMV Manager account is missing." }, { status: 400 });
=======
  const initialApprover = configuredWorkflow?.approverId ? configuredWorkflow.approver : requiresApprover1 ? approver1 : requiresApprover2 ? approver2 : approver3;
  const initialStatus = configuredWorkflow?.status ?? (requiresApprover1 ? DocumentStatus.PENDING_APPROVER_1 : requiresApprover2 ? DocumentStatus.PENDING_APPROVER_2 : DocumentStatus.PENDING_APPROVER_3);

  if (!initialApprover) {
    return NextResponse.json({ message: "Initial approver account is missing." }, { status: 400 });
>>>>>>> origin/errs-pos
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
          select: { id: true },
        });
        if (!comparison) {
          throw new Error("The selected comparison is no longer available or is not approved.");
        }
      }

      const createdDocuments = [] as Array<{ id: string; documentNumber: string; title: string }>;

      for (const [index, file] of files.entries()) {
        const documentNumber = await nextDocumentNumber(tx);
        const perFileTitle = fileTitles[index]?.trim() || file.name.replace(/\.[^.]+$/, "") || title || "Untitled Document";
        const normalizedDocumentType = documentType === "COMPARISON" ? DocumentType.COMPARISON : DocumentType.MATERIAL_REQUISITION;
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
          uploaderLocation: uploader.location,
          projectName: uploader.projectName ?? null,
          workflowTemplateId: configuredWorkflow?.templateId ?? null,
          currentWorkflowStep: configuredWorkflow?.stepNumber ?? null,
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
          location: uploader.location,
          documentType: normalizedDocumentType === DocumentType.COMPARISON ? "COMPARISON" : "MATERIAL_REQUISITION",
          mrType: normalizedMrType === MrType.CREDIT ? "CREDIT" : normalizedMrType === MrType.CASH ? "CASH" : null,
          hasLinkedComparison: isMrLinked,
        });
        const saved = await saveDocumentVersionFile({
          documentId: document.id,
          versionNumber: 0,
          file,
          documentType: normalizedDocumentType === DocumentType.COMPARISON ? "COMPARISON" : "MATERIAL_REQUISITION",
          documentNumber,
          mrNumber: documentType === "MATERIAL_REQUISITION" ? mrNumber || null : null,
          hasLinkedComparison: isMrLinked,
          uploaderEmail: uploader.email,
          mrType: normalizedMrType === MrType.CREDIT ? "CREDIT" : normalizedMrType === MrType.CASH ? "CASH" : null,
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
