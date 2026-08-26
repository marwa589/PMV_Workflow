import { ApprovalActionType, DocumentStatus, DocumentType, MrType, Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { copyComparisonToMrFolder, saveDocumentVersionFile } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { queueWorkflowEmailEvents } from "@/lib/workflow-email-batching";

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

  if (relatedComparisonId && files.length > 1) {
    return NextResponse.json({ message: "A related comparison can only be linked to one MR." }, { status: 400 });
  }

  const approver2 = await prisma.user.findFirst({
    where: { role: UserRole.APPROVER_2 },
    select: { id: true, email: true, name: true },
  });
  const approver3 = await prisma.user.findFirst({
    where: { role: UserRole.APPROVER_3 },
    select: { id: true, email: true, name: true },
  });

  // if (!approver2) {
  //   return NextResponse.json({ message: "Workshop Manager account is missing." }, { status: 400 });
  // }
  if (!approver3) {
    return NextResponse.json({ message: "PMV Manager account is missing." }, { status: 400 });
  }
  const initialApprover = documentType === "COMPARISON" && comparisonType === "SPARE_PARTS" ? approver2 : approver3;
  if (!initialApprover) {
    return NextResponse.json({ message: "Workshop Manager account is missing for Spare Parts comparisons." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (relatedComparisonId) {
        const comparison = await tx.document.findFirst({
          where: {
            id: relatedComparisonId,
            documentType: DocumentType.COMPARISON,
            status: DocumentStatus.APPROVED,
            linkedMRs: { none: {} },
          },
          select: { id: true },
        });
        if (!comparison) {
          throw new Error("The selected comparison is no longer available or is already linked to an MR.");
        }
      }

      const createdDocuments = [] as Array<{ id: string; documentNumber: string; title: string; compVersionForCopy: { filePath: string; originalName: string } | null; mrNumberForCopy: string | null }>;

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
          status: initialApprover === approver2 ? DocumentStatus.PENDING_APPROVER_2 : DocumentStatus.PENDING_APPROVER_3,
          currentVersion: 0,
          createdById: session.userId,
          lastActiveStage: initialApprover === approver2 ? DocumentStatus.PENDING_APPROVER_2 : DocumentStatus.PENDING_APPROVER_3,
          currentApproverId: initialApprover.id,
          currentApproverAssignedAt: new Date(),
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

        const isMrLinked = normalizedDocumentType === DocumentType.MATERIAL_REQUISITION && !!relatedComparisonId && !!mrNumber;
        const saved = await saveDocumentVersionFile({
          documentId: document.id,
          versionNumber: 0,
          file,
          documentType: normalizedDocumentType === DocumentType.COMPARISON ? "COMPARISON" : "MATERIAL_REQUISITION",
          documentNumber,
          mrNumber: documentType === "MATERIAL_REQUISITION" ? mrNumber || null : null,
          hasLinkedComparison: isMrLinked,
        });

        // If MR links a comparison, record its comparison path for post-transaction copy
        let compVersionForCopy: { filePath: string; originalName: string } | null = null;
        if (isMrLinked) {
          compVersionForCopy = await tx.documentVersion.findFirst({
            where: { documentId: relatedComparisonId },
            orderBy: { versionNumber: "desc" },
            select: { filePath: true, originalName: true },
          });
        }

        const version = await tx.documentVersion.create({
          data: {
            documentId: document.id,
            versionNumber: 0,
            filePath: saved.relativePath,
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

        createdDocuments.push({ id: document.id, documentNumber: document.documentNumber, title: perFileTitle, compVersionForCopy, mrNumberForCopy: isMrLinked ? mrNumber : null });
      }

      return createdDocuments;
    });

    // Copy comparison files into MRs+Comparisons folder after transaction (file ops outside tx)
    await Promise.all(
      result.map(async (doc) => {
        if (doc.compVersionForCopy && doc.mrNumberForCopy) {
          await copyComparisonToMrFolder({
            comparisonFilePath: doc.compVersionForCopy.filePath,
            comparisonOriginalName: doc.compVersionForCopy.originalName,
            mrNumber: doc.mrNumberForCopy,
          });
        }
      }),
    );

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
