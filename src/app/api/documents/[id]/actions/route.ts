import { ApprovalActionType, DocumentStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { deleteDocumentFiles, mergePdfFiles, saveDocumentVersionFile, uploadSavedFileToGraph } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { APPROVER_WORKFLOW, getWorkflowAuthorizationPolicy, isApproverRole } from "@/lib/workflow";
import { queueWorkflowEmailEvents } from "@/lib/workflow-email-batching";
import { writeAuditLog } from "@/lib/audit";
import { runInBackground } from "@/lib/background";
import { downloadFileFromGraph } from "@/lib/graph-upload";

export const runtime = "nodejs";

type Decision = "APPROVE" | "REJECT" | "COMMENT";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!isApproverRole(session.role)) {
    return NextResponse.json({ message: "Only approvers can perform this action." }, { status: 403 });
  }

  const { id: documentId } = await params;
  const formData = await request.formData();
  const decision = String(formData.get("decision") || "").trim().toUpperCase() as Decision;
  const comments = String(formData.get("comments") || "").trim();
  const fileValue = formData.get("file");
  const signatureCount = Number(formData.get("signatureCount") || 0);

  if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "COMMENT") {
    return NextResponse.json({ message: "Decision must be APPROVE, REJECT, or COMMENT." }, { status: 400 });
  }

  const workflow = APPROVER_WORKFLOW[session.role];
  const startedAt = performance.now();

  try {
    const postSaveGraphUploads: Array<Parameters<typeof uploadSavedFileToGraph>[0]> = [];

    const result = await prisma.$transaction(async (tx) => {
      const document = await tx.document.findUnique({
        where: { id: documentId },
        select: {
          id: true,
          documentNumber: true,
          title: true,
          status: true,
          currentVersion: true,
          currentApproverId: true,
          createdById: true,
          documentType: true,
          comparisonType: true,
          mrNumber: true,
          relatedComparisonId: true,
        },
      });

      if (!document) {
        throw new Error("Document not found.");
      }

      if (document.currentApproverId !== session.userId) {
        throw new Error("This document is not assigned to you.");
      }

      const policy = getWorkflowAuthorizationPolicy({
        role: session.role,
        currentStatus: document.status,
        action: decision,
      });

      if (!policy.allowed) {
        throw new Error(policy.reason || "Document is not in your approval step.");
      }

      const currentVersionRecord = await tx.documentVersion.findUnique({
        where: {
          documentId_versionNumber: {
            documentId: document.id,
            versionNumber: document.currentVersion,
          },
        },
        select: { id: true },
      });

      if (!currentVersionRecord) {
        throw new Error("Current document version not found.");
      }

      if (decision === "REJECT") {
        const aqueel = await tx.user.findUnique({
          where: { email: "aqueel.sayed@ahmadiah.com" },
          select: { id: true },
        });
        if (!aqueel) {
          throw new Error("Aqueel Sayed clerk account not found.");
        }

        const versionFilesToDelete = await tx.documentVersion.findMany({
          where: {
            documentId: document.id,
            versionNumber: { gt: 0 },
          },
          select: { id: true, filePath: true },
        });

        await tx.document.update({
          where: { id: document.id },
          data: {
            status: DocumentStatus.REJECTED,
            currentVersion: 0,
            currentApproverId: aqueel.id,
            currentApproverAssignedAt: null,
            lastActiveStage: document.status,
          },
        });

        await tx.approvalHistory.create({
          data: {
            documentId: document.id,
            versionId: currentVersionRecord.id,
            action: ApprovalActionType.REJECTED,
            comments: comments || null,
            performedById: session.userId,
          },
        });

        await writeAuditLog({
          documentId: document.id,
          performedById: session.userId,
          action: "DOCUMENT_REJECTED",
          details: JSON.stringify({
            decision,
            comments: comments || null,
            approverRole: session.role,
            previousStatus: document.status,
          }),
        });

        runInBackground(async () => {
          await createNotification({
            userId: aqueel.id,
            type: "DOCUMENT_REJECTED",
            title: "Document rejected",
            message: `${document.documentNumber} - ${document.title}`,
            documentId: document.id,
          });
        });

        await tx.documentVersion.deleteMany({
          where: {
            documentId: document.id,
            versionNumber: { gt: 0 },
          },
        });

        await Promise.all(
          versionFilesToDelete.map(async (version) => {
            try {
              await deleteDocumentFiles({ filePaths: [version.filePath] });
            } catch {
              // Ignore missing files so rejection still succeeds.
            }
          }),
        );

        return {
          status: DocumentStatus.REJECTED,
          currentVersion: 0,
          emailRecipientId: aqueel.id,
        };
      }

      if (decision === "COMMENT") {
        const sparePartsRevision = session.role === UserRole.APPROVER_3
          && document.documentType === "COMPARISON"
          && document.comparisonType === "SPARE_PARTS";
        const routing = sparePartsRevision
          ? { status: DocumentStatus.REVISION_REQUIRED, targetRole: UserRole.APPROVER_2 }
          : { status: DocumentStatus.REVISION_REQUIRED, targetRole: null };
        let assignedApproverId: string | null = null;
        let nextVersionNumber = document.currentVersion;
        let revisionVersionId = currentVersionRecord.id;

        if (routing.targetRole) {
          const targetApprover = await tx.user.findFirst({
            where: { role: routing.targetRole },
            select: { id: true },
          });

          if (!targetApprover) {
            throw new Error(`User for ${routing.targetRole} not found.`);
          }

          assignedApproverId = targetApprover.id;
        } else {
          const aqueel = await tx.user.findUnique({
            where: { email: "aqueel.sayed@ahmadiah.com" },
            select: { id: true },
          });
          if (!aqueel) {
            throw new Error("Aqueel Sayed clerk account not found.");
          }
          assignedApproverId = aqueel.id;
        }

        if (fileValue instanceof File) {
          nextVersionNumber = document.currentVersion + 1;
          const saved = await saveDocumentVersionFile({
            documentId: document.id,
            versionNumber: nextVersionNumber,
            file: fileValue,
            documentType: document.documentType === "COMPARISON" ? "COMPARISON" : "MATERIAL_REQUISITION",
            documentNumber: document.documentNumber,
            mrNumber: document.mrNumber,
            hasLinkedComparison: !!document.relatedComparisonId,
          });

          const newVersion = await tx.documentVersion.create({
            data: {
              documentId: document.id,
              versionNumber: nextVersionNumber,
              filePath: saved.relativePath,
              originalName: fileValue.name,
              extension: saved.extension,
              mimeType: fileValue.type || "application/octet-stream",
              fileSize: fileValue.size,
              uploadedById: session.userId,
            },
          });

          postSaveGraphUploads.push({
            relativePath: saved.relativePath,
            fileName: fileValue.name,
            folder: document.documentType === "COMPARISON" ? "Comparisons" : document.mrNumber ? "MRs+Comparisons" : "MRs",
            documentId: document.id,
            versionId: newVersion.id,
            performedById: session.userId,
            context: "DOCUMENT_REVISION",
          });

          revisionVersionId = newVersion.id;
        }

        await tx.document.update({
          where: { id: document.id },
          data: {
            currentVersion: nextVersionNumber,
            status: routing.status,
            currentApproverId: assignedApproverId,
            currentApproverAssignedAt: new Date(),
            lastActiveStage: routing.status,
          },
        });

        await tx.approvalHistory.create({
          data: {
            documentId: document.id,
            versionId: revisionVersionId,
            action: ApprovalActionType.REQUESTED_REVISION,
            comments: comments || null,
            performedById: session.userId,
          },
        });

        await writeAuditLog({
          documentId: document.id,
          performedById: session.userId,
          action: "DOCUMENT_REVISION_REQUESTED",
          details: JSON.stringify({
            decision,
            comments: comments || null,
            approverRole: session.role,
            targetRole: routing.targetRole,
            previousStatus: document.status,
          }),
        });

        if (assignedApproverId) {
          runInBackground(async () => {
            await createNotification({
              userId: assignedApproverId,
              type: "DOCUMENT_REVISED",
              title: "Revision requested",
              message: `${document.documentNumber} - ${document.title}`,
              documentId: document.id,
            });
          });
        }

        return {
          status: routing.status,
          currentVersion: nextVersionNumber,
          emailRecipientId: assignedApproverId,
        };
      }

      if (!(fileValue instanceof File)) {
        throw new Error("Approved action requires an uploaded file.");
      }

      const nextVersionNumber = document.currentVersion + 1;
      const isMergedApproval = !workflow.nextApproverRole && document.documentType === "MATERIAL_REQUISITION" && !!document.relatedComparisonId;
      const targetGraphFolder = document.documentType === "COMPARISON"
        ? "Comparisons"
        : isMergedApproval
          ? "MRs+Comparisons"
          : "MRs";
      
      // Fetch previous version's Graph metadata for replacement (signed versions should replace the file)
      const previousVersion = await tx.documentVersion.findUnique({
        where: {
          documentId_versionNumber: {
            documentId: document.id,
            versionNumber: document.currentVersion,
          },
        },
        select: { driveId: true, itemId: true },
      });

      const saved = await saveDocumentVersionFile({
        documentId: document.id,
        versionNumber: nextVersionNumber,
        file: fileValue,
        documentType: document.documentType === "COMPARISON" ? "COMPARISON" : "MATERIAL_REQUISITION",
        documentNumber: document.documentNumber,
        mrNumber: document.mrNumber,
        hasLinkedComparison: !!document.relatedComparisonId,
      });

      let finalFilePath = saved.relativePath;
      let finalOriginalName = fileValue.name;
      let mergedSourcePaths: string[] = [];
      let mergedPdfBuffer: Buffer | null = null;
      if (isMergedApproval && document.relatedComparisonId) {
        const comparison = await tx.document.findUnique({
          where: { id: document.relatedComparisonId },
          select: { status: true, title: true },
        });
        const comparisonVersion = await tx.documentVersion.findFirst({
          where: { documentId: document.relatedComparisonId },
          orderBy: { versionNumber: "desc" },
          select: { filePath: true, driveId: true, itemId: true },
        });

        if (comparison?.status === DocumentStatus.APPROVED && comparisonVersion) {
          const comparisonBuffer = comparisonVersion.driveId && comparisonVersion.itemId
            ? await downloadFileFromGraph(comparisonVersion.driveId, comparisonVersion.itemId)
            : undefined;

          const merged = await mergePdfFiles({
            firstFilePath: comparisonVersion.filePath,
            secondFilePath: saved.relativePath,
            firstBuffer: comparisonBuffer,
            secondBuffer: saved.buffer,
            fileName: `${document.title} + ${comparison.title}`,
          });
          finalFilePath = merged.relativePath;
          finalOriginalName = `${document.title} + ${comparison.title}.pdf`;
          mergedPdfBuffer = merged.buffer;
          mergedSourcePaths = [saved.relativePath];
        }
      }

      const newVersion = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: nextVersionNumber,
          filePath: finalFilePath,
          originalName: finalOriginalName,
          extension: saved.extension,
          mimeType: fileValue.type || "application/octet-stream",
          fileSize: fileValue.size,
          uploadedById: session.userId,
        },
      });

      const graphReplacementMetadata = !isMergedApproval && previousVersion?.driveId && previousVersion?.itemId
        ? { driveId: previousVersion.driveId, itemId: previousVersion.itemId }
        : null;
      const graphUploadFolder = isMergedApproval ? "MRs+Comparisons" : targetGraphFolder;
      const graphUploadContext = isMergedApproval ? "MERGED_PDF_UPLOAD" : "DOCUMENT_APPROVAL";

      postSaveGraphUploads.push({
        relativePath: finalFilePath,
        fileName: finalOriginalName,
        folder: graphUploadFolder,
        documentId: document.id,
        versionId: newVersion.id,
        performedById: session.userId,
        context: graphUploadContext,
        replaceGraphMetadata: graphReplacementMetadata,
        buffer: mergedPdfBuffer ?? Buffer.from(await fileValue.arrayBuffer()),
      });

      const versionsToDeleteAfterCommit = workflow.nextApproverRole
        ? []
        : await tx.documentVersion.findMany({
            where: {
              documentId: document.id,
              versionNumber: { lt: nextVersionNumber },
            },
            select: { filePath: true },
          });

      let nextApproverId: string | null = null;
      if (workflow.nextApproverRole) {
        const nextApprover = await tx.user.findFirst({
          where: { role: workflow.nextApproverRole },
          select: { id: true },
        });

        if (!nextApprover) {
          throw new Error(`User for ${workflow.nextApproverRole} not found.`);
        }

        nextApproverId = nextApprover.id;
      }

      await tx.document.update({
        where: { id: document.id },
        data: {
          currentVersion: nextVersionNumber,
          status: workflow.nextStatus,
          currentApproverId: nextApproverId,
          currentApproverAssignedAt: nextApproverId ? new Date() : null,
          lastActiveStage: workflow.nextStatus,
        },
      });

      if (!workflow.nextApproverRole) {
        await tx.documentVersion.deleteMany({
          where: {
            documentId: document.id,
            versionNumber: { lt: nextVersionNumber },
          },
        });
      }

      await tx.approvalHistory.create({
        data: {
          documentId: document.id,
          versionId: newVersion.id,
          action: ApprovalActionType.APPROVED,
          comments: comments || null,
          performedById: session.userId,
        },
      });

      await writeAuditLog({
        documentId: document.id,
        performedById: session.userId,
        action: workflow.nextApproverRole ? "DOCUMENT_APPROVED_STAGE" : "DOCUMENT_APPROVED",
        details: JSON.stringify({
          decision,
          comments: comments || null,
          approverRole: session.role,
          nextStatus: workflow.nextStatus,
          previousStatus: document.status,
          nextApproverRole: workflow.nextApproverRole,
          signatureCount: Number.isFinite(signatureCount) ? signatureCount : 0,
        }),
      });

      if (workflow.nextApproverRole) {
        if (nextApproverId) {
          runInBackground(async () => {
            await createNotification({
              userId: nextApproverId,
              type: "PENDING_APPROVAL",
              title: "Document awaiting your review",
              message: `${document.documentNumber} - ${document.title}`,
              documentId: document.id,
            });
          });
        }
      } else {
        runInBackground(async () => {
          await createNotification({
            userId: document.createdById,
            type: "DOCUMENT_APPROVED",
            title: "Document approved",
            message: `${document.documentNumber} - ${document.title}`,
            documentId: document.id,
          });
        });
      }

      return {
        status: workflow.nextStatus,
        currentVersion: nextVersionNumber,
        versionsToDeleteAfterCommit,
        currentFilePath: finalFilePath,
        mergedSourcePaths,
        emailRecipientId: nextApproverId || document.createdById,
      };
    });

    const documentForEmail = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        documentNumber: true,
        title: true,
        status: true,
        documentType: true,
        mrType: true,
        createdAt: true,
        currentApprover: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    console.info(`[actions] Transaction completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });

    if (result.status === DocumentStatus.APPROVED) {
      const versionsToDeleteAfterCommit = (
        result as typeof result & { versionsToDeleteAfterCommit?: { filePath: string }[] }
      ).versionsToDeleteAfterCommit || [];
      const currentFilePath = (
        result as typeof result & { currentFilePath?: string }
      ).currentFilePath;
      const mergedSourcePaths = (
        result as typeof result & { mergedSourcePaths?: string[] }
      ).mergedSourcePaths || [];

      const legacyMrPathsForDelete: string[] = [];
      if (documentForEmail?.documentType === "MATERIAL_REQUISITION" && documentForEmail?.mrType) {
        const legacyVersions = await prisma.documentVersion.findMany({
          where: {
            documentId,
            filePath: { startsWith: "MRs/" },
          },
          select: { filePath: true },
        });
        legacyMrPathsForDelete.push(...legacyVersions.map((version) => version.filePath));
      }

      await Promise.all(
        [...versionsToDeleteAfterCommit.map((version) => version.filePath), ...mergedSourcePaths, ...legacyMrPathsForDelete].map(async (filePath) => {
          if (filePath === currentFilePath) return;
          try {
            await deleteDocumentFiles({ filePaths: [filePath] });
          } catch {
            // Ignore missing files so approval still succeeds.
          }
        }),
      );
      console.info(`[actions] File cleanup completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });
    }

    if (
      documentForEmail?.currentApprover?.email &&
      (result.status === DocumentStatus.PENDING_APPROVER_1 ||
        result.status === DocumentStatus.PENDING_APPROVER_2 ||
        result.status === DocumentStatus.PENDING_APPROVER_3 ||
        result.status === DocumentStatus.REVISION_REQUIRED)
    ) {
      const recipients = new Set<string>();
      if (result.status === DocumentStatus.REVISION_REQUIRED) {
        if (result.emailRecipientId) recipients.add(result.emailRecipientId);
      } else if (documentForEmail.currentApprover.id) {
        recipients.add(documentForEmail.currentApprover.id);
      }
      await queueWorkflowEmailEvents([...recipients].map((recipientId) => ({
        recipientId,
        type: "APPROVAL_PENDING" as const,
        documentId,
      })));
    }

    if (result.status === DocumentStatus.APPROVED || result.status === DocumentStatus.REJECTED) {
      const approvedRecipientEmail = documentForEmail?.documentType === "COMPARISON"
        ? "aqueel.sayed@ahmadiah.com"
        : "omar.merzek@ahmadiah.com";
      const clerkRecipients = await prisma.user.findMany({
        where: {
          role: UserRole.CLERK,
          email: result.status === DocumentStatus.APPROVED
            ? approvedRecipientEmail
            : "aqueel.sayed@ahmadiah.com",
        },
        select: { id: true, email: true },
      });
      const emailType = result.status === DocumentStatus.APPROVED ? "WORKFLOW_APPROVED" : "WORKFLOW_REJECTED";
      await queueWorkflowEmailEvents(clerkRecipients.map((clerk) => ({ recipientId: clerk.id, type: emailType, documentId })));
    }

    console.info(`[actions] Queueing completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });

    // Execute all queued Graph uploads after local operations succeed
    await Promise.all(postSaveGraphUploads.map((upload) => uploadSavedFileToGraph(upload)));

    console.info(`[actions] Graph uploads completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });

    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const getDocumentTypeLabel = (document: {
      documentType?: string | null;
      mrType?: string | null;
    }) => {
      if (document.documentType === "MATERIAL_REQUISITION") {
        if (document.mrType === "CASH") return "MR Cash";
        if (document.mrType === "CREDIT") return "MR Credit";
        return "MR";
      }

      return "Comparison";
    };

    if (
      documentForEmail?.currentApprover?.email &&
      (result.status === DocumentStatus.PENDING_APPROVER_1 ||
        result.status === DocumentStatus.PENDING_APPROVER_2 ||
        result.status === DocumentStatus.PENDING_APPROVER_3)
    ) {
      const pendingSubject = `Document Approval Required - ${documentForEmail.documentNumber}`;
      const pendingHtml = `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-family: Arial, sans-serif; background-color: #f5f7fb; padding: 24px;">
          <tr>
            <td align="center">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width: 640px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
                <tr>
                  <td style="background-color: #464feb; padding: 24px 32px; color: #ffffff;">
                    <h2 style="margin: 0; font-size: 24px;">Document Approval Required</h2>
                    <p style="margin: 6px 0 0 0; font-size: 14px;">${documentForEmail.documentNumber}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 32px; color: #111827;">
                    <p style="margin: 0 0 12px 0; font-size: 16px;">Dear ${documentForEmail.currentApprover.name || "Approver"},</p>
                    <p style="margin: 0 0 20px 0; font-size: 15px;">A document has been assigned to you for review and approval.</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Details</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;"></td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Number</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${documentForEmail.documentNumber}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Type</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${getDocumentTypeLabel(documentForEmail)}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Submitted By</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${documentForEmail.createdBy?.name || documentForEmail.createdBy?.email || "Unknown"}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Submission Date</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(documentForEmail.createdAt))}</td>
                      </tr>
                    </table>
                    <p style="margin: 0 0 12px 0; font-size: 15px;">Please log in to the PMV Workflow System to review and take the necessary action.</p>
                    <p style="margin: 0 0 12px 0; font-size: 15px;"><strong>System URL:</strong> <a href="${appUrl}" style="text-decoration: none; color: #464feb;">${appUrl}</a></p>
                    <p style="margin: 0 0 6px 0; font-size: 15px;">Thank you.</p>
                    <p style="margin: 0; font-size: 15px;">Best regards,<br />PMV Workflow System</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;

    }

    if (
      result.status === DocumentStatus.REVISION_REQUIRED &&
      documentForEmail?.currentApprover?.email
    ) {
      const revisionSubject = `Document requires revision - ${documentForEmail.documentNumber}`;
      const revisionHtml = `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-family: Arial, sans-serif; background-color: #f5f7fb; padding: 24px;">
          <tr>
            <td align="center">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width: 640px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
                <tr>
                  <td style="background-color: #b45309; padding: 24px 32px; color: #ffffff;">
                    <h2 style="margin: 0; font-size: 24px;">Revision Required</h2>
                    <p style="margin: 6px 0 0 0; font-size: 14px;">${documentForEmail.documentNumber}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 32px; color: #111827;">
                    <p style="margin: 0 0 12px 0; font-size: 16px;">Dear ${documentForEmail.currentApprover.name || "Approver"},</p>
                    <p style="margin: 0 0 20px 0; font-size: 15px;">A document has been returned to you for revision review. Please review the comments and take the appropriate action.</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Number</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${documentForEmail.documentNumber}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Type</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${getDocumentTypeLabel(documentForEmail)}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Status</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">Revision Required</td>
                      </tr>
                    </table>
                    <p style="margin: 0 0 12px 0; font-size: 15px;"><strong>System URL:</strong> <a href="${appUrl}" style="text-decoration: none; color: #464feb;">${appUrl}</a></p>
                    <p style="margin: 0; font-size: 15px;">Best regards,<br />PMV Workflow System</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;

    }

    if (
      result.status === DocumentStatus.APPROVED &&
      documentForEmail?.createdBy?.email
    ) {
      const subject = `Document Approved - ${documentForEmail.documentNumber}`;
      const html = `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-family: Arial, sans-serif; background-color: #f5f7fb; padding: 24px;">
          <tr>
            <td align="center">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width: 640px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
                <tr>
                  <td style="background-color: #0f766e; padding: 24px 32px; color: #ffffff;">
                    <h2 style="margin: 0; font-size: 24px;">Document Approved</h2>
                    <p style="margin: 6px 0 0 0; font-size: 14px;">${documentForEmail.documentNumber}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 32px; color: #111827;">
                    <p style="margin: 0 0 12px 0; font-size: 16px;">Dear ${documentForEmail.createdBy.name || "Clerk"},</p>
                    <p style="margin: 0 0 20px 0; font-size: 15px;">Your document has completed the approval workflow.</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Details</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;"></td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Number</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${documentForEmail.documentNumber}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Type</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${getDocumentTypeLabel(documentForEmail)}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Status</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">Approved</td>
                      </tr>
                    </table>
                    <p style="margin: 0 0 12px 0; font-size: 15px;">The final approved version is now available for download from the PMV Workflow System.</p>
                    <p style="margin: 0 0 12px 0; font-size: 15px;"><strong>System URL:</strong> <a href="${appUrl}" style="text-decoration: none; color: #464feb;">${appUrl}</a></p>
                    <p style="margin: 0; font-size: 15px;">Best regards,<br />PMV Workflow System</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;

    }

    console.info(`[actions] Request completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });
    return NextResponse.json({ message: "Action processed.", result }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Unable to process action.",
      },
      { status: 400 },
    );
  }
}
