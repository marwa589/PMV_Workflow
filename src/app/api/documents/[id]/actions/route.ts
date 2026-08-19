import { ApprovalActionType, DocumentStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { deleteDocumentFiles, saveDocumentVersionFile } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { createNotification } from "@/lib/notifications";
import { APPROVER_WORKFLOW, getCommentRouting, getWorkflowAuthorizationPolicy, isApproverRole } from "@/lib/workflow";
import { sendAdminOutcomeEmails, sendPendingAgeAlertEmails } from "@/lib/document-aging";
import { writeAuditLog } from "@/lib/audit";
import { runInBackground } from "@/lib/background";

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

  if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "COMMENT") {
    return NextResponse.json({ message: "Decision must be APPROVE, REJECT, or COMMENT." }, { status: 400 });
  }

  const workflow = APPROVER_WORKFLOW[session.role];

  try {
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
            currentApproverId: null,
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
            userId: document.createdById,
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
        };
      }

      if (decision === "COMMENT") {
        const routing = getCommentRouting(session.role);
        let assignedApproverId: string | null = document.createdById;
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
        };
      }

      if (!(fileValue instanceof File)) {
        throw new Error("Approved action requires an uploaded file.");
      }

      const nextVersionNumber = document.currentVersion + 1;
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
        }),
      });

      if (workflow.nextApproverRole) {
        const nextApprover = await tx.user.findFirst({
          where: { role: workflow.nextApproverRole },
          select: { id: true },
        });

        if (nextApprover) {
          runInBackground(async () => {
            await createNotification({
              userId: nextApprover.id,
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
      };
    });

    runInBackground(async () => {
      await sendPendingAgeAlertEmails();
    });

    if (result.status === DocumentStatus.APPROVED) {
      const versionsToDeleteAfterCommit = (
        result as typeof result & { versionsToDeleteAfterCommit?: { filePath: string }[] }
      ).versionsToDeleteAfterCommit || [];

      await Promise.all(
        versionsToDeleteAfterCommit.map(async (version) => {
          try {
            await deleteDocumentFiles({ filePaths: [version.filePath] });
          } catch {
            // Ignore missing files so approval still succeeds.
          }
        }),
      );
    }

    const documentForEmail = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        documentNumber: true,
        title: true,
        status: true,
        documentType: true,
        mrType: true,
        createdAt: true,
        currentApprover: { select: { name: true, email: true } },
        createdBy: { select: { name: true, email: true } },
      },
    });

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

      runInBackground(async () => {
        if (!documentForEmail.currentApprover?.email) return;
        await sendEmail({
          to: documentForEmail.currentApprover.email,
          subject: pendingSubject,
          html: pendingHtml,
        });
      });
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

      runInBackground(async () => {
        if (!documentForEmail.currentApprover?.email) return;
        await sendEmail({
          to: documentForEmail.currentApprover.email,
          subject: revisionSubject,
          html: revisionHtml,
        });
      });
    }

    if (result.status === DocumentStatus.APPROVED) {
      runInBackground(async () => {
        await sendAdminOutcomeEmails({
          documentNumber: documentForEmail?.documentNumber || documentId,
          title: documentForEmail?.title || "Document",
          outcome: "approved",
        });
      });
    }

    if (
      result.status === DocumentStatus.REJECTED
    ) {
      runInBackground(async () => {
        await sendAdminOutcomeEmails({
          documentNumber: documentForEmail?.documentNumber || documentId,
          title: documentForEmail?.title || "Document",
          outcome: "rejected",
          clerkEmail: documentForEmail?.createdBy?.email,
          clerkName: documentForEmail?.createdBy?.name,
        });
      });
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

      runInBackground(async () => {
        await sendEmail({
          to: documentForEmail.createdBy.email,
          subject,
          html,
        });
      });
    }

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
