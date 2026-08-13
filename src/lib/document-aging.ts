import { ApprovalActionType, DocumentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { createNotification } from "@/lib/notifications";
import { runInBackground } from "@/lib/background";

const PENDING_STATUSES = [
  DocumentStatus.PENDING_APPROVER_1,
  DocumentStatus.PENDING_APPROVER_2,
  DocumentStatus.PENDING_APPROVER_3,
  DocumentStatus.REVISION_REQUIRED,
];

export function getWaitingHours(assignedAt: Date | null): number {
  if (!assignedAt) return 0;
  const diffMs = Date.now() - new Date(assignedAt).getTime();
  return diffMs / (1000 * 60 * 60);
}

export async function sendPendingAgeAlertEmails() {
  const pendingDocuments = await prisma.document.findMany({
    where: {
      status: { in: PENDING_STATUSES },
      currentApproverAssignedAt: { not: null },
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      currentApproverAssignedAt: true,
    },
  });

  const adminUsers = await prisma.user.findMany({
    where: { role: UserRole.ADMIN },
    select: { id: true, name: true, email: true },
  });

  if (adminUsers.length === 0) {
    return 0;
  }

  let sentCount = 0;

  for (const document of pendingDocuments) {
    const assignedAt = document.currentApproverAssignedAt;
    if (!assignedAt) continue;

    const hours = getWaitingHours(assignedAt);
    if (hours < 3) continue;

    for (const admin of adminUsers) {
      const existingAlert = await prisma.notification.findFirst({
        where: {
          userId: admin.id,
          documentId: document.id,
          title: "Document age alert",
        },
      });

      if (existingAlert) continue;

      const subject = `Pending document age alert - ${document.documentNumber}`;
      const html = `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-family: Arial, sans-serif; background-color: #f5f7fb; padding: 24px;">
          <tr>
            <td align="center">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width: 640px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
                <tr>
                  <td style="background-color: #b45309; padding: 24px 32px; color: #ffffff;">
                    <h2 style="margin: 0; font-size: 24px;">Pending document age alert</h2>
                    <p style="margin: 6px 0 0 0; font-size: 14px;">${document.documentNumber}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 32px; color: #111827;">
                    <p style="margin: 0 0 12px 0; font-size: 16px;">Hello ${admin.name || "Admin"},</p>
                    <p style="margin: 0 0 20px 0; font-size: 15px;">A pending document has been waiting for action for over 3 hours.</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Number</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${document.documentNumber}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Title</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${document.title}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Age</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}</td>
                      </tr>
                    </table>
                    <p style="margin: 0; font-size: 15px;">Please review the workflow queue and follow up as needed.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;

      await sendEmail({
        to: admin.email,
        subject,
        html,
      });

      await createNotification({
        userId: admin.id,
        type: "PENDING_APPROVAL",
        title: "Document age alert",
        message: `${document.documentNumber} - ${document.title}`,
        documentId: document.id,
      });

      sentCount += 1;
    }
  }

  return sentCount;
}

export async function sendComparisonMrFollowUpAlerts() {
  const adminUsers = await prisma.user.findMany({
    where: { role: UserRole.ADMIN },
    select: { id: true, name: true, email: true },
  });

  if (adminUsers.length === 0) {
    return 0;
  }

  const pendingComparisons = await prisma.document.findMany({
    where: {
      documentType: "COMPARISON",
      status: DocumentStatus.APPROVED,
      linkedMRs: { none: {} },
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      approvals: {
        where: { action: ApprovalActionType.APPROVED },
        orderBy: { performedAt: "desc" },
        take: 1,
        select: { performedAt: true },
      },
    },
  });

  let sentCount = 0;

  for (const comparison of pendingComparisons) {
    const approvedAt = comparison.approvals[0]?.performedAt;
    if (!approvedAt) continue;

    const hours = (Date.now() - new Date(approvedAt).getTime()) / (1000 * 60 * 60);
    if (hours < 24) continue;

    for (const admin of adminUsers) {
      const existingAlert = await prisma.notification.findFirst({
        where: {
          userId: admin.id,
          documentId: comparison.id,
          title: "Comparison MR follow-up alert",
        },
      });

      if (existingAlert) continue;

      const subject = `Comparison MR follow-up overdue - ${comparison.documentNumber}`;
      const html = `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-family: Arial, sans-serif; background-color: #f5f7fb; padding: 24px;">
          <tr>
            <td align="center">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width: 640px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
                <tr>
                  <td style="background-color: #b45309; padding: 24px 32px; color: #ffffff;">
                    <h2 style="margin: 0; font-size: 24px;">Comparison MR follow-up overdue</h2>
                    <p style="margin: 6px 0 0 0; font-size: 14px;">${comparison.documentNumber}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 32px; color: #111827;">
                    <p style="margin: 0 0 12px 0; font-size: 16px;">Hello ${admin.name || "Admin"},</p>
                    <p style="margin: 0 0 20px 0; font-size: 15px;">The linked MR for this approved comparison has not been uploaded within 24 hours.</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Comparison</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${comparison.documentNumber}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Title</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${comparison.title}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Overdue By</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}</td>
                      </tr>
                    </table>
                    <p style="margin: 0; font-size: 15px;">Please follow up on the missing MR linkage.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;

      await sendEmail({ to: admin.email, subject, html });
      await createNotification({
        userId: admin.id,
        type: "PENDING_APPROVAL",
        title: "Comparison MR follow-up alert",
        message: `${comparison.documentNumber} - ${comparison.title}`,
        documentId: comparison.id,
      });
      sentCount += 1;
    }
  }

  return sentCount;
}

export async function sendAdminOutcomeEmails(params: {
  documentNumber: string;
  title: string;
  outcome: "approved" | "rejected";
  clerkEmail?: string | null;
  clerkName?: string | null;
}) {
  const adminUsers = await prisma.user.findMany({
    where: { role: UserRole.ADMIN },
    select: { id: true, name: true, email: true },
  });

  if (adminUsers.length === 0) {
    return 0;
  }

  const subject = params.outcome === "approved"
    ? `Document approved - ${params.documentNumber}`
    : `Document rejected - ${params.documentNumber}`;

  const title = params.outcome === "approved" ? "Document Approved" : "Document Rejected";
  const message = params.outcome === "approved"
    ? `The document has completed the workflow and was approved.`
    : `The document was rejected during the workflow.`;

  const html = `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-family: Arial, sans-serif; background-color: #f5f7fb; padding: 24px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width: 640px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
            <tr>
              <td style="background-color: ${params.outcome === "approved" ? "#0f766e" : "#b91c1c"}; padding: 24px 32px; color: #ffffff;">
                <h2 style="margin: 0; font-size: 24px;">${title}</h2>
                <p style="margin: 6px 0 0 0; font-size: 14px;">${params.documentNumber}</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px; color: #111827;">
                <p style="margin: 0 0 12px 0; font-size: 16px;">Hello Admin,</p>
                <p style="margin: 0 0 20px 0; font-size: 15px;">${message}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
                  <tr>
                    <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Number</th>
                    <td style="padding: 10px; border: 1px solid #e6e6e6;">${params.documentNumber}</td>
                  </tr>
                  <tr>
                    <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Title</th>
                    <td style="padding: 10px; border: 1px solid #e6e6e6;">${params.title}</td>
                  </tr>
                  <tr>
                    <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Outcome</th>
                    <td style="padding: 10px; border: 1px solid #e6e6e6;">${params.outcome === "approved" ? "Approved" : "Rejected"}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  let sentCount = 0;
  for (const admin of adminUsers) {
    await sendEmail({ to: admin.email, subject, html });
    await createNotification({
      userId: admin.id,
      type: params.outcome === "approved" ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED",
      title: params.outcome === "approved" ? "Document approved" : "Document rejected",
      message: `${params.documentNumber} - ${params.title}`,
      documentId: null,
    });
    sentCount += 1;
  }

  if (params.outcome === "rejected" && params.clerkEmail) {
    await sendEmail({
      to: params.clerkEmail,
      subject,
      html: `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-family: Arial, sans-serif; background-color: #f5f7fb; padding: 24px;">
          <tr>
            <td align="center">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" style="max-width: 640px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
                <tr>
                  <td style="background-color: #b91c1c; padding: 24px 32px; color: #ffffff;">
                    <h2 style="margin: 0; font-size: 24px;">${title}</h2>
                    <p style="margin: 6px 0 0 0; font-size: 14px;">${params.documentNumber}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 32px; color: #111827;">
                    <p style="margin: 0 0 12px 0; font-size: 16px;">Hello ${params.clerkName || "Clerk"},</p>
                    <p style="margin: 0 0 20px 0; font-size: 15px;">${message}</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Document Number</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${params.documentNumber}</td>
                      </tr>
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Title</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${params.title}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
    });
  }

  return sentCount;
}
