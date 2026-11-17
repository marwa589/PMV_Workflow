// src/app/api/documents/[id]/actions/route.ts
import { DocumentStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { deleteDocumentFiles, saveDocumentVersionFile } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { performWorkflowAction, type WorkflowActionInput } from "@/lib/workflow/engine";
import { dispatchWorkflowEffects } from "@/lib/workflow/effects";
import { WorkflowError } from "@/lib/workflow/errors";

export const runtime = "nodejs";

const DECISIONS = ["APPROVE", "REJECT", "REQUEST_REVISION", "HOLD", "RESUME", "RESUBMIT", "SEND_FOR_APPROVAL"] as const;
type Decision = (typeof DECISIONS)[number];

const AUDIT_ACTION: Record<Decision, string> = {
  APPROVE: "DOCUMENT_APPROVED_STAGE",
  REJECT: "DOCUMENT_REJECTED",
  REQUEST_REVISION: "DOCUMENT_REVISION_REQUESTED",
  HOLD: "DOCUMENT_ON_HOLD",
  RESUME: "DOCUMENT_RESUMED",
  RESUBMIT: "DOCUMENT_RESUBMITTED",
  SEND_FOR_APPROVAL: "DOCUMENT_SENT_FOR_APPROVAL",
};

/**
 * One endpoint for every step of a document's life.
 * multipart form fields: decision, comments, file, signatureCount, targetLevel
 *  - APPROVE            needs the signed/annotated file (becomes the new version)
 *  - REQUEST_REVISION   needs a comment; targetLevel is optional (defaults to the previous step); file optional
 *  - RESUBMIT           the selected earlier step sends the revised file back to the requesting reviewer; file required
 *  - SEND_FOR_APPROVAL  recipientUserId (who approves first) and signatureRequired ("true"/"false", default true); no file.
 *                       The chosen user approves, then the document comes back to the sender.
 *  - REJECT, HOLD, RESUME  no file
 * Who is allowed to act is decided by the engine from the flow copied onto the document.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id: documentId } = await params;
  const savedPaths: string[] = [];
  // Becomes true once the database transaction has committed. From then on the action HAS happened,
  // so nothing after this point may report a failure or delete the files the new version points to.
  let committed = false;
  let decisionForLog = "";

  try {
    const formData = await request.formData();
    const decision = String(formData.get("decision") || "").trim().toUpperCase() as Decision;
    const comments = String(formData.get("comments") || "").trim();
    const fileValue = formData.get("file");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
    const signatureCount = Number(formData.get("signatureCount") || 0);
    const trackIdValue = String(formData.get("trackId") || "").trim();
    const recipientUserId = String(formData.get("recipientUserId") || "").trim();
    const signatureRequiredValue = String(formData.get("signatureRequired") ?? "true").trim().toLowerCase();
    const signatureRequired = !(signatureRequiredValue === "false" || signatureRequiredValue === "0");
    const targetLevelValue = formData.get("targetLevel");
    const targetLevel = targetLevelValue === null || String(targetLevelValue).trim() === "" ? null : Number(targetLevelValue);

    decisionForLog = decision;
    if (!DECISIONS.includes(decision)) {
      throw new WorkflowError(`Decision must be one of: ${DECISIONS.join(", ")}.`, 400);
    }
    if ((decision === "APPROVE" || decision === "RESUBMIT") && !file) {
      throw new WorkflowError(decision === "APPROVE" ? "Approved action requires an uploaded file." : "Resubmitting requires the revised file.", 400);
    }
    if (decision === "SEND_FOR_APPROVAL" && !recipientUserId) {
      throw new WorkflowError("Choose the person who should approve this document.", 400);
    }
    if (decision === "REQUEST_REVISION" && targetLevel !== null && (!Number.isInteger(targetLevel) || targetLevel < 0)) {
      throw new WorkflowError("Choose a valid earlier workflow step.", 400);
    }

    const actor = { id: session.userId, userType: session.userType };
    const startedAt = performance.now();

    const outcome = await prisma.$transaction(
      async (tx) => {
        const document = await tx.document.findUnique({
          where: { id: documentId },
          select: { id: true, documentNumber: true, status: true, currentVersion: true },
        });
        if (!document) throw new WorkflowError("Document not found.", 404);

        const currentVersionRecord = await tx.documentVersion.findUnique({
          where: { documentId_versionNumber: { documentId: document.id, versionNumber: document.currentVersion } },
          select: { id: true, storageFolder: true },
        });
        if (!currentVersionRecord) throw new WorkflowError("Current document version not found.", 404);

        // A new file becomes the next version, stored next to the earlier ones.
        let nextVersionNumber = document.currentVersion;
        let newVersionId: string | null = null;

        if (file && (decision === "APPROVE" || decision === "RESUBMIT" || decision === "REQUEST_REVISION")) {
          nextVersionNumber = document.currentVersion + 1;
          const saved = await saveDocumentVersionFile({
            documentId: document.id,
            versionNumber: nextVersionNumber,
            file,
            documentNumber: document.documentNumber,
            storageFolder: currentVersionRecord.storageFolder,
          });
          savedPaths.push(saved.relativePath);

          const newVersion = await tx.documentVersion.create({
            data: {
              documentId: document.id,
              versionNumber: nextVersionNumber,
              filePath: saved.relativePath,
              storageFolder: saved.storageFolder,
              originalName: file.name,
              extension: saved.extension,
              mimeType: file.type || "application/octet-stream",
              fileSize: file.size,
              uploadedById: session.userId,
            },
          });
          newVersionId = newVersion.id;
        }

        let input: WorkflowActionInput;
        switch (decision) {
          case "APPROVE":
            input = { action: "APPROVE", comment: comments || null, versionId: currentVersionRecord.id, outputVersionId: newVersionId, trackId: trackIdValue || null };
            break;
          case "REJECT":
            input = { action: "REJECT", comment: comments || null, versionId: currentVersionRecord.id };
            break;
          case "REQUEST_REVISION":
            input = { action: "REQUEST_REVISION", comment: comments, targetLevel, versionId: newVersionId ?? currentVersionRecord.id };
            break;
          case "HOLD":
            input = { action: "HOLD", comment: comments || null };
            break;
          case "RESUME":
            input = { action: "RESUME", comment: comments || null };
            break;
          case "SEND_FOR_APPROVAL":
            input = { action: "SEND_FOR_APPROVAL", recipientUserId, signatureRequired, comment: comments || null, versionId: currentVersionRecord.id };
            break;
          default:
            input = { action: "RESUBMIT", comment: comments || null, versionId: newVersionId };
        }

        // Checks who may act, then moves the document and records the history.
        const result = await performWorkflowAction(tx, { documentId: document.id, actor, input });

        if (newVersionId) {
          await tx.document.update({ where: { id: document.id }, data: { currentVersion: nextVersionNumber } });
        }

        return { result, previousStatus: document.status, currentVersion: nextVersionNumber };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    committed = true;

    console.info(`[actions] Transaction completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });

    // Everything below is follow-up work (emails, notifications, audit entry). The decision is already saved, so a
    // failure here is logged but never turned into an error for the person, and never removes any file.

    // Rejected: stop any "please review" emails still waiting to be sent.
    if (outcome.result.status === DocumentStatus.CANCELLED) {
      try {
        await prisma.emailNotificationEvent.updateMany({
          where: { documentId, emailSent: false, type: { in: ["APPROVAL_PENDING", "APPROVAL_OVERDUE"] } },
          data: { emailSent: true, claimedAt: null },
        });
      } catch (followUpError) {
        console.error("[actions] Could not cancel pending review emails after reject", { documentId, error: followUpError });
      }
    }

    try {
      await dispatchWorkflowEffects(outcome.result.effects);
    } catch (followUpError) {
      console.error("[actions] Could not queue notifications/emails after the action", { documentId, decision, error: followUpError });
    }

    const auditEntry = {
      documentId,
      performedById: session.userId,
      action: outcome.result.auditAction ?? (decision === "APPROVE" && outcome.result.status === DocumentStatus.APPROVED ? "DOCUMENT_APPROVED" : AUDIT_ACTION[decision]),
      details: JSON.stringify({
        decision,
        comments: comments || null,
        userType: session.userType,
        previousStatus: outcome.previousStatus,
        nextStatus: outcome.result.status,
        currentWorkflowStep: outcome.result.currentWorkflowStep,
        targetLevel: decision === "REQUEST_REVISION" ? targetLevel : null,
        signatureCount: Number.isFinite(signatureCount) ? signatureCount : 0,
        ...(outcome.result.auditDetails ?? {}),
      }),
    };
    try {
      await writeAuditLog(auditEntry);
    } catch (followUpError) {
      // Logged with the full entry so it can be recovered by hand.
      console.error("[actions] Could not write the audit log entry", { entry: auditEntry, error: followUpError });
    }

    return NextResponse.json(
      {
        message: "Action processed.",
        result: {
          status: outcome.result.status,
          currentVersion: outcome.currentVersion,
          currentWorkflowStep: outcome.result.currentWorkflowStep,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    // Previously nothing was logged here, so a failed action left no trace on the server.
    console.error("[actions] Action failed", {
      documentId,
      decision: decisionForLog,
      userId: session.userId,
      committed,
      status: error instanceof WorkflowError ? error.status : 400,
      error,
    });

    // If the database work was rolled back, remove any file that was already written.
    // After a commit the files belong to the saved version and must stay.
    if (savedPaths.length > 0 && !committed) {
      await deleteDocumentFiles({ filePaths: savedPaths }).catch(() => undefined);
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to process this action." },
      { status: error instanceof WorkflowError ? error.status : 400 },
    );
  }
}
