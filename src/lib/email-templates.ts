export type EmailTextContext = {
  recipientName?: string | null;
  docNumber?: string | null;
  title?: string | null;
  workflowType?: string | null;
  projectName?: string | null;
  currentStatus?: string | null;
  currentStage?: string | null;
  actorName?: string | null;
  comments?: string | null;
  documentUrl?: string | null;
};

function escapeHtml(value?: string | null) {
  return (value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatTextLine(label: string, value?: string | null) {
  if (!value) return "";
  return `${label}: ${value}\n`;
}

function makeFieldList(context: EmailTextContext) {
  return [
    formatTextLine("Document", context.docNumber ? `${context.docNumber} — ${context.title ?? ""}`.trim() : context.title ?? null),
    formatTextLine("Workflow", context.workflowType ?? null),
    formatTextLine("Project", context.projectName ?? null),
    formatTextLine("Current status", context.currentStatus ?? null),
    formatTextLine("Comments", context.comments ?? null),
  ].filter(Boolean).join("");
}

function buildCommonHtml(context: EmailTextContext, intro: string, actionLabel: string, actionText: string) {
  const escapedName = escapeHtml(context.recipientName || "there");
  const escapedDoc = escapeHtml(context.docNumber ?? "document");
  const escapedTitle = escapeHtml(context.title ?? "Untitled document");
  const escapedWorkflow = escapeHtml(context.workflowType ?? "workflow document");
  const escapedProject = escapeHtml(context.projectName ?? "—");
  const escapedStatus = escapeHtml(context.currentStatus ?? "—");
  const escapedComments = escapeHtml(context.comments ?? "No comments were provided.");
  const escapedUrl = context.documentUrl ? escapeHtml(context.documentUrl) : null;

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0;padding:0;background:#eef2f7;font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="720" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:720px;margin:0 auto;">
            <tr>
              <td style="background:#0f172a;color:#fff;padding:22px 28px;border-radius:12px 12px 0 0;">
                <div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;opacity:0.78;">PMV Workflow</div>
                <h1 style="margin:8px 0 0;font-size:28px;line-height:1.25;">${escapeHtml(intro)}</h1>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
                <p style="margin:0 0 16px;">Hello ${escapedName},</p>
                <p style="margin:0 0 20px;">${escapeHtml(actionText)}</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;">
                  <tbody>
                    <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;width:35%;">Document</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${escapedDoc}${context.title ? ` — ${escapedTitle}` : ""}</td></tr>
                    <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;">Workflow</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${escapedWorkflow}</td></tr>
                    <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;">Project</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${escapedProject}</td></tr>
                    <tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:700;">Current status</td><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${escapedStatus}</td></tr>
                    <tr><td style="padding:10px 12px;font-weight:700;">Comments</td><td style="padding:10px 12px;">${escapedComments}</td></tr>
                  </tbody>
                </table>

                ${escapedUrl ? `<p style="margin:20px 0 0;"><a href="${escapedUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">${escapeHtml(actionLabel)}</a></p>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function buildPlainText(context: EmailTextContext, intro: string, actionText: string) {
  return [
    `PMV Workflow - ${intro}`,
    "",
    `Hello ${context.recipientName || "there"},`,
    actionText,
    "",
    makeFieldList(context),
    context.documentUrl ? `Open document: ${context.documentUrl}` : "",
  ].filter(Boolean).join("\n");
}

export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

export function buildApprovalAssignedEmail(context: EmailTextContext): EmailTemplate {
  return {
    subject: `Action required: ${context.docNumber ?? "Document"}`,
    html: buildCommonHtml(
      context,
      "Approval assigned",
      "Approval assigned",
      `${context.actorName ?? "A reviewer"} has assigned you this ${context.workflowType ?? "workflow document"} for approval.`,
    ),
    text: buildPlainText(
      context,
      "Approval assigned",
      `${context.actorName ?? "A reviewer"} has assigned you this ${context.workflowType ?? "workflow document"} for approval.`,
    ),
  };
}

export function buildDocumentRejectedEmail(context: EmailTextContext): EmailTemplate {
  return {
    subject: `Document rejected: ${context.docNumber ?? "Document"}`,
    html: buildCommonHtml(
      context,
      "Document rejected",
      "View document",
      `${context.actorName ?? "A reviewer"} rejected this ${context.workflowType ?? "workflow document"}.`,
    ),
    text: buildPlainText(
      context,
      "Document rejected",
      `${context.actorName ?? "A reviewer"} rejected this ${context.workflowType ?? "workflow document"}.`,
    ),
  };
}

export function buildRevisionRequiredEmail(context: EmailTextContext): EmailTemplate {
  return {
    subject: `Revision required: ${context.docNumber ?? "Document"}`,
    html: buildCommonHtml(
      context,
      "Revision required",
      "Review revision request",
      `${context.actorName ?? "A reviewer"} requested changes to this ${context.workflowType ?? "workflow document"}.`,
    ),
    text: buildPlainText(
      context,
      "Revision required",
      `${context.actorName ?? "A reviewer"} requested changes to this ${context.workflowType ?? "workflow document"}.`,
    ),
  };
}

export function buildFinalApprovalEmail(context: EmailTextContext): EmailTemplate {
  return {
    subject: `Final approval complete: ${context.docNumber ?? "Document"}`,
    html: buildCommonHtml(
      context,
      "Final approval complete",
      "Open document",
      `This ${context.workflowType ?? "workflow document"} has completed the approval chain and the final outcome is now available.`,
    ),
    text: buildPlainText(
      context,
      "Final approval complete",
      `This ${context.workflowType ?? "workflow document"} has completed the approval chain and the final outcome is now available.`,
    ),
  };
}

export function buildErrFinalApprovalToMarcEmail(context: EmailTextContext): EmailTemplate {
  return {
    subject: `ERR final approval notification: ${context.docNumber ?? "Document"}`,
    html: buildCommonHtml(
      context,
      "ERR final approval notification",
      "Review ERR",
      `The ERR workflow has reached its final approval stage and the status is now available for review by PMV Manager.`,
    ),
    text: buildPlainText(
      context,
      "ERR final approval notification",
      `The ERR workflow has reached its final approval stage and the status is now available for review by PMV Manager.`,
    ),
  };
}

export function buildErrOnHoldEmail(context: EmailTextContext): EmailTemplate {
  return {
    subject: `ERR on hold: ${context.docNumber ?? "Document"}`,
    html: buildCommonHtml(
      context,
      "ERR on hold",
      "View ERR",
      `This ERR has been placed on hold and requires attention before the workflow can continue.`,
    ),
    text: buildPlainText(
      context,
      "ERR on hold",
      `This ERR has been placed on hold and requires attention before the workflow can continue.`,
    ),
  };
}
