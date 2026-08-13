import { ApprovalActionType, DocumentStatus, DocumentType, MrType, Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { copyComparisonToMrFolder, saveDocumentVersionFile } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { createNotification } from "@/lib/notifications";
import { runInBackground } from "@/lib/background";

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

  if (files.length === 0) {
    return NextResponse.json({ message: "At least one file is required." }, { status: 400 });
  }

  const approver1 = await prisma.user.findFirst({
    where: { role: UserRole.APPROVER_1 },
    select: { id: true, email: true, name: true },
  });

  // edit
  // const approver2 = await prisma.user.findFirst({
  //   where: { role: UserRole.APPROVER_2 },
  //   select: { id: true, email: true, name: true },
  // });
  // edit

  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN },
    select: { id: true, email: true, name: true },
  });

  if (!approver1?.email) {
    return NextResponse.json({ message: "Approver 1 account is missing or has no email address." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
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
          //edit
          // status: DocumentStatus.PENDING_APPROVER_2,
          status: DocumentStatus.PENDING_APPROVER_1,
          currentVersion: 0,
          createdById: session.userId,
          //edit
          // lastActiveStage: DocumentStatus.PENDING_APPROVER_2,
          // currentApproverId: approver2!.id,
          lastActiveStage: DocumentStatus.PENDING_APPROVER_1,
          currentApproverId: approver1.id,
          currentApproverAssignedAt: new Date(),
          documentType: normalizedDocumentType,
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

    const recipients = [
      approver1.email ? { email: approver1.email, name: approver1.name || "Approver", role: "approver" as const } : null,
      ...admins
        .filter((admin): admin is (typeof admins)[number] & { email: string } => Boolean(admin.email))
        .map((admin) => ({ email: admin.email, name: admin.name || "Admin", role: "admin" as const })),
    ].filter((recipient): recipient is { email: string; name: string; role: "approver" | "admin" } => recipient !== null);

    if (recipients.length > 0) {
      runInBackground(async () => {
        await Promise.all(
          result.flatMap((document) =>
            recipients.map(async (recipient) => {
              const notificationMessage = recipient.role === "admin"
                ? `A new document is waiting for review.`
                : `You have a new document to review.`;

              await createNotification({
                userId: recipient.role === "admin" ? admins.find((admin) => admin.email === recipient.email)?.id || "" : approver1.id,
                type: "PENDING_APPROVAL",
                title: `New document ready for review`,
                message: `${document.documentNumber} - ${document.title}`,
                documentId: document.id,
              });
              const subject = recipient.role === "admin"
                ? `New document uploaded: ${document.documentNumber}`
                : `New pending approval: ${document.documentNumber}`;

              const html = recipient.role === "admin"
                ? `
                  <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                    <p>Hello ${recipient.name},</p>
                    <p>A clerk has uploaded a new document and it is waiting for review.</p>
                    <p><strong>Document:</strong> ${document.documentNumber}</p>
                    <p><strong>Title:</strong> ${document.title}</p>
                    <p>Please log in to the system to review the document queue.</p>
                    <p>Regards,<br />DocuFlow 365</p>
                  </div>
                `
                : `
                  <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                    <p>Hello ${recipient.name},</p>
                    <p>A new document is awaiting your review.</p>
                    <p><strong>Document:</strong> ${document.documentNumber}</p>
                    <p><strong>Title:</strong> ${document.title}</p>
                    <p>Please log in to the system to review it.</p>
                    <p>Regards,<br />DocuFlow 365</p>
                  </div>
                `;

              await sendEmail({
                to: recipient.email,
                subject,
                html,
              });
            }),
          ),
        );
      });
    }

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
