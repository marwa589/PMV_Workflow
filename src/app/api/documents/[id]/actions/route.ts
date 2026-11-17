import { ApprovalActionType, DocumentStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { deleteDocumentFiles, mergePdfFiles, saveDocumentVersionFile } from "@/lib/files";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/lib/notifications";
import { APPROVER_WORKFLOW, getWorkflowAuthorizationPolicy, isApproverRole } from "@/lib/workflow";
import { queueWorkflowEmailEvents } from "@/lib/workflow-email-batching";
import { writeAuditLog } from "@/lib/audit";
import { runInBackground } from "@/lib/background";
import { canAccessMrModuleForSession } from "@/lib/auth/resource-access";
import { resolveNextWorkflowStepForApproval } from "@/lib/document-workflow-config";
import { documentStorageFolder } from "@/lib/storage-layout";
import { appConfig } from "@/lib/env";
import { isKsaViewer } from "@/lib/ksa-viewer";
import { resolveWorkflowApproverIdsForUploader } from "@/lib/workflow-locations";
import { isAvkUploaderWorkflowDocument, isRamziDocumentApprover, MARC_PMV_MANAGER_EMAIL, MOHAMED_AVK_WORKFLOW_UPLOADER_EMAIL } from "@/lib/mohamed-document-workflow";
import { canRedirectDocuments, isRedirectedToUser, isRedirectTargetRole, parseRedirectFallback } from "@/lib/document-redirect";
import { getKsaProjectByName, isKsaProjectDirector, isKsaProjectDirectorForDocument } from "@/lib/ksa-projects";
import { effectiveDocumentLocation } from "@/lib/document-location";

export const runtime = "nodejs";

function escapeEmailHtml(value: string | null | undefined): string {
  return (value ?? "No comments were provided.")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br />");
}

type Decision = "APPROVE" | "REJECT" | "COMMENT" | "REDIRECT";
type ApprovalRoute = "FINALIZE" | "MANAGING_DIRECTOR";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (isKsaViewer(session)) {
    return NextResponse.json({ message: "KSA Viewer access is read-only." }, { status: 403 });
  }

  const { id: documentId } = await params;
  // KSA project directors (Elie Azzam for Ready Mix Khobar, Elias Nassar for WP03 MRs).
  const isReadyMixDirectorAccount = isKsaProjectDirector(session.email);
  const isRamziAccount = isRamziDocumentApprover(session.email);
  // A user Marc redirected a document to may act on that document whatever their role.
  const isRedirectTargetAccount = Boolean(await prisma.document.findFirst({
    where: { id: documentId, currentApproverId: session.userId, redirectedById: { not: null } },
    select: { id: true },
  }));
  if ((!isApproverRole(session.role) || !canAccessMrModuleForSession(session)) && !isReadyMixDirectorAccount && !isRamziAccount && !isRedirectTargetAccount) {
    return NextResponse.json({ message: "Only approvers can perform this action." }, { status: 403 });
  }

  const formData = await request.formData();
  const decision = String(formData.get("decision") || "").trim().toUpperCase() as Decision;
  const approvalRoute = String(formData.get("approvalRoute") || "").trim().toUpperCase() as ApprovalRoute | "";
  const comments = String(formData.get("comments") || "").trim();
  const fileValue = formData.get("file");
  const signatureCount = Number(formData.get("signatureCount") || 0);
  const redirectToUserId = String(formData.get("redirectToUserId") || "").trim();
  const redirectFallback = parseRedirectFallback(String(formData.get("redirectFallback") || "").trim().toUpperCase());

  if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "COMMENT" && decision !== "REDIRECT") {
    return NextResponse.json({ message: "Decision must be APPROVE, REJECT, COMMENT, or REDIRECT." }, { status: 400 });
  }

  const workflow = isApproverRole(session.role) ? APPROVER_WORKFLOW[session.role] : null;
  const startedAt = performance.now();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const document = await tx.document.findUnique({
        where: { id: documentId },
        select: {
          id: true,
          documentNumber: true,
          title: true,
          status: true,
          projectName: true,
          uploaderLocation: true,
          currentVersion: true,
          currentApproverId: true,
          createdById: true,
          createdBy: {
            select: { id: true, name: true, email: true, location: true },
          },
          mrType: true,
          workflowTemplateId: true,
          currentWorkflowStep: true,
          documentType: true,
          comparisonType: true,
          mrNumber: true,
          relatedComparisonId: true,
          redirectedById: true,
          redirectFallback: true,
          workflowTemplate: {
            select: {
              id: true,
              steps: {
                orderBy: { stepNumber: "asc" },
                select: {
                  id: true,
                  stepNumber: true,
                  role: true,
                  approverUserId: true,
                  approver: { select: { id: true, email: true, name: true } },
                },
              },
            },
          },
        },
      });

      if (!document) {
        throw new Error("Document not found.");
      }

      // The document is with the person Marc redirected it to: their decision replaces Marc's
      // stage, so none of the role-based routing below applies to it.
      const isRedirectedAction = isRedirectedToUser(document, session.userId);
      const isReadyMixDirectorAction = !isRedirectedAction
        && isReadyMixDirectorAccount
        && isKsaProjectDirectorForDocument(session.email, document);
      const isMohamedWorkflowAction = !isRedirectedAction
        && isRamziAccount
        && document.documentType === "MATERIAL_REQUISITION"
        && isAvkUploaderWorkflowDocument(document.createdBy?.email, document.documentType, document.uploaderLocation)
        && document.status === DocumentStatus.PENDING_APPROVER_1;

      if (document.currentApproverId !== session.userId) {
        throw new Error("This document is not assigned to you.");
      }

      if (isRedirectedAction) {
        if (decision === "REDIRECT") {
          throw new Error("This document was redirected to you and cannot be redirected again.");
        }
      } else if (decision === "REDIRECT") {
        if (!canRedirectDocuments(session.email)) {
          throw new Error("You are not allowed to redirect documents.");
        }
        if (
          document.status !== DocumentStatus.PENDING_APPROVER_1
          && document.status !== DocumentStatus.PENDING_APPROVER_2
          && document.status !== DocumentStatus.PENDING_APPROVER_3
        ) {
          throw new Error("Only documents pending your approval can be redirected.");
        }
      } else if (isReadyMixDirectorAction) {
        if (document.status !== DocumentStatus.PENDING_APPROVER_1 || decision === "COMMENT") {
          throw new Error(`This ${document.projectName ?? "project"} document is not available for your approval action.`);
        }
      } else if (!isMohamedWorkflowAction) {
        if (!workflow || !canAccessMrModuleForSession(session)) {
          throw new Error("Only approvers can perform this action.");
        }

        const policy = getWorkflowAuthorizationPolicy({
          role: session.role,
          currentStatus: document.status,
          action: decision,
        });

        if (!policy.allowed) {
          throw new Error(policy.reason || "Document is not in your approval step.");
        }
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

      if (decision === "REDIRECT") {
        if (!redirectToUserId) {
          throw new Error("Choose the user to redirect this document to.");
        }
        if (!redirectFallback) {
          throw new Error("Choose what happens after the document is approved (Fully approve or Back to me).");
        }
        if (redirectToUserId === session.userId) {
          throw new Error("You cannot redirect a document to yourself.");
        }

        const redirectTarget = await tx.user.findUnique({
          where: { id: redirectToUserId },
          select: { id: true, name: true, email: true, role: true },
        });

        if (!redirectTarget || !isRedirectTargetRole(redirectTarget.role)) {
          throw new Error("The selected user cannot review documents.");
        }

        await tx.document.update({
          where: { id: document.id },
          data: {
            currentApproverId: redirectTarget.id,
            currentApproverAssignedAt: new Date(),
            redirectedById: session.userId,
            redirectFallback,
          },
        });

        await tx.approvalHistory.create({
          data: {
            documentId: document.id,
            versionId: currentVersionRecord.id,
            action: ApprovalActionType.REDIRECTED,
            comments: comments || null,
            performedById: session.userId,
          },
        });

        await writeAuditLog({
          documentId: document.id,
          performedById: session.userId,
          action: "DOCUMENT_REDIRECTED",
          details: JSON.stringify({
            decision,
            comments: comments || null,
            approverRole: session.role,
            status: document.status,
            redirectedToUserId: redirectTarget.id,
            redirectedToEmail: redirectTarget.email,
            redirectFallback,
          }),
        });

        runInBackground(async () => {
          await createNotification({
            userId: redirectTarget.id,
            type: "PENDING_APPROVAL",
            title: "Document redirected to you for review",
            message: `${document.documentNumber} - ${document.title}`,
            documentId: document.id,
          });
        });

        return {
          status: document.status,
          currentVersion: document.currentVersion,
          emailRecipientId: redirectTarget.id,
        };
      }

      if (decision === "REJECT") {
        const uploader = document.createdBy ?? await tx.user.findUnique({
          where: { id: document.createdById },
          select: { id: true, name: true, email: true },
        });

        if (!uploader) {
          throw new Error("Uploader account not found for this document.");
        }

        await tx.document.update({
          where: { id: document.id },
          data: {
            status: DocumentStatus.REJECTED,
            currentVersion: document.currentVersion,
            currentApproverId: uploader.id,
            currentApproverAssignedAt: new Date(),
            lastActiveStage: document.status,
            redirectedById: null,
            redirectFallback: null,
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
            redirectedAction: isRedirectedAction,
            previousStatus: document.status,
            returnedToUploaderId: uploader.id,
            returnedToUploaderEmail: uploader.email,
          }),
        });

        runInBackground(async () => {
          await createNotification({
            userId: uploader.id,
            type: "DOCUMENT_REJECTED",
            title: "Document rejected and returned to you",
            message: `${document.documentNumber} - ${document.title}`,
            documentId: document.id,
          });
        });

        return {
          status: DocumentStatus.REJECTED,
          currentVersion: document.currentVersion,
          emailRecipientId: uploader.id,
        };
      }

      if (decision === "COMMENT") {
        // A redirected reviewer requests revision on Marc's behalf, so it routes like Marc's.
        const sparePartsRevision = (session.role === UserRole.APPROVER_3 || isRedirectedAction)
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
            where: { role: routing.targetRole},
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
            documentType: document.documentType,
            documentNumber: document.documentNumber,
            mrNumber: document.mrNumber,
            hasLinkedComparison: !!document.relatedComparisonId,
            uploaderEmail: document.createdBy?.email ?? undefined,
            location: effectiveDocumentLocation(document) ?? undefined,
            projectName: document.projectName,
            mrType: document.mrType ?? undefined,
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
            redirectedById: null,
            redirectFallback: null,
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
            redirectedAction: isRedirectedAction,
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
      const saved = await saveDocumentVersionFile({
        documentId: document.id,
        versionNumber: nextVersionNumber,
        file: fileValue,
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        mrNumber: document.mrNumber,
        hasLinkedComparison: !!document.relatedComparisonId,
        uploaderEmail: document.createdBy?.email ?? undefined,
        location: effectiveDocumentLocation(document) ?? undefined,
        projectName: document.projectName,
        mrType: document.mrType ?? undefined,
      });

      // Redirected document: "Fully approve" finishes the workflow now, "Back to me" returns it
      // to Marc (the redirector) at the same stage for his own decision.
      const redirectFullyApproves = isRedirectedAction && document.redirectFallback === "FULLY_APPROVE";
      const redirectBackToRedirector = isRedirectedAction && !redirectFullyApproves;
      const isFinalApprovalForMerge = isRedirectedAction
        ? redirectFullyApproves
        : !workflow?.nextApproverRole && !isReadyMixDirectorAction;

      let finalFilePath = saved.relativePath;
      let finalOriginalName = fileValue.name;
      let mergedSourcePaths: string[] = [];
      if (isFinalApprovalForMerge && document.documentType === "MATERIAL_REQUISITION" && document.relatedComparisonId) {
        const comparison = await tx.document.findUnique({
          where: { id: document.relatedComparisonId },
          select: {
            status: true,
            title: true,
            currentVersion: true,
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { filePath: true },
            },
          },
        });
        const comparisonVersion = comparison?.versions[0];
        if (comparison?.status === DocumentStatus.APPROVED && comparisonVersion) {
          const merged = await mergePdfFiles({
            firstFilePath: comparisonVersion.filePath,
            secondFilePath: saved.relativePath,
            fileName: `${document.mrNumber || document.documentNumber} - ${document.title} + ${comparison.title}`,
            storageFolder: saved.storageFolder || documentStorageFolder({
              uploaderEmail: document.createdBy?.email ?? "",
              location: effectiveDocumentLocation(document) ?? undefined,
              projectName: document.projectName,
              documentType: "MATERIAL_REQUISITION",
              mrType: document.mrType ?? null,
              hasLinkedComparison: true,
            }) || undefined,
          });
          finalFilePath = merged.relativePath;
          finalOriginalName = `${document.mrNumber || document.documentNumber} - ${document.title} + ${comparison.title}.pdf`;
          mergedSourcePaths = [saved.relativePath];
        }
      }

      const previousVersions = await tx.documentVersion.findMany({
        where: { documentId: document.id },
        select: { id: true, filePath: true },
      });

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

      const nextApproverRole = isRedirectedAction
        ? (redirectBackToRedirector ? UserRole.APPROVER_3 : null)
        : isReadyMixDirectorAction
        ? UserRole.APPROVER_3
        : isMohamedWorkflowAction
          ? UserRole.APPROVER_3
        : document.documentType === "CUSTODY" && session.role === UserRole.APPROVER_1
          ? UserRole.APPROVER_3
          : workflow?.nextApproverRole ?? null;
      let nextApproverId: string | null = null;
      let nextStatus = isRedirectedAction
        ? (redirectBackToRedirector ? document.status : DocumentStatus.APPROVED)
        : isReadyMixDirectorAction
        ? DocumentStatus.PENDING_APPROVER_3
        : isMohamedWorkflowAction
          ? DocumentStatus.PENDING_APPROVER_3
        : document.documentType === "CUSTODY" && session.role === UserRole.APPROVER_1
          ? DocumentStatus.PENDING_APPROVER_3
          : workflow?.nextStatus ?? DocumentStatus.APPROVED;
      let nextWorkflowStep: number | null = null;
      const templateTransition = resolveNextWorkflowStepForApproval(document.workflowTemplate, document.currentWorkflowStep);

      if (isRedirectedAction) {
        if (redirectBackToRedirector && !document.redirectedById) {
          throw new Error("The user who redirected this document is not available.");
        }
        nextApproverId = redirectBackToRedirector ? document.redirectedById : null;
        nextWorkflowStep = document.currentWorkflowStep;
      } else if (isReadyMixDirectorAction) {
        const avrApprovers = await resolveWorkflowApproverIdsForUploader(tx, document.createdBy?.email);
        if (!avrApprovers.approver3Id) {
          throw new Error("The AVR PMV Manager account is missing.");
        }
        nextApproverId = avrApprovers.approver3Id;
      } else if (isMohamedWorkflowAction) {
        const marc = await tx.user.findUnique({
          where: { email: MARC_PMV_MANAGER_EMAIL },
          select: { id: true },
        });
        if (!marc) {
          throw new Error("Marc Baddour's PMV Manager account is not available.");
        }
        nextApproverId = marc.id;
      } else if (session.role === UserRole.APPROVER_3 && approvalRoute === "MANAGING_DIRECTOR") {
        const managingDirector = await tx.user.findFirst({
          where: { role: UserRole.ADMIN },
          select: { id: true },
        });

        if (managingDirector) {
          nextApproverId = managingDirector.id;
          nextStatus = DocumentStatus.PENDING_APPROVER_3;
          nextWorkflowStep = document.currentWorkflowStep;
        } else {
          nextStatus = DocumentStatus.APPROVED;
          nextApproverId = null;
        }
      }

      if (!isRedirectedAction && !isReadyMixDirectorAction && document.workflowTemplate && document.workflowTemplate.steps.length > 0 && templateTransition.currentStep) {
        const fallbackApprover = templateTransition.nextStep?.approverUserId ?? templateTransition.nextStep?.approver?.id ?? null;
        if (templateTransition.nextStep) {
          nextApproverId = fallbackApprover ?? null;
          nextStatus = templateTransition.nextStatus ?? workflow?.nextStatus ?? DocumentStatus.APPROVED;
          nextWorkflowStep = templateTransition.nextStep.stepNumber;
        } else {
          nextApproverId = null;
          nextStatus = DocumentStatus.APPROVED;
          nextWorkflowStep = templateTransition.currentStep.stepNumber;
        }
      } else if (!isRedirectedAction && !isReadyMixDirectorAction && !isMohamedWorkflowAction && nextApproverRole) {
        const nextApprover = await tx.user.findFirst({
          where: { role: nextApproverRole },
          select: { id: true },
        });

        if (!nextApprover) {
          throw new Error(`User for ${nextApproverRole} not found.`);
        }

        nextApproverId = nextApprover.id;
      }

      await tx.document.update({
        where: { id: document.id },
        data: {
          currentVersion: nextVersionNumber,
          status: nextStatus,
          currentApproverId: nextApproverId,
          currentApproverAssignedAt: nextApproverId ? new Date() : null,
          currentWorkflowStep: nextWorkflowStep,
          lastActiveStage: nextStatus,
          ...(isRedirectedAction ? { redirectedById: null, redirectFallback: null } : {}),
        },
      });

      await tx.documentVersion.deleteMany({
        where: {
          documentId: document.id,
          versionNumber: { lt: nextVersionNumber },
        },
      });

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
        action: nextApproverRole ? "DOCUMENT_APPROVED_STAGE" : "DOCUMENT_APPROVED",
        details: JSON.stringify({
          decision,
          comments: comments || null,
          approverRole: session.role,
          nextStatus,
          previousStatus: document.status,
          nextApproverRole,
          redirectedAction: isRedirectedAction,
          redirectFallback: isRedirectedAction ? document.redirectFallback : null,
          signatureCount: Number.isFinite(signatureCount) ? signatureCount : 0,
        }),
      });

      if (nextApproverRole) {
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
        status: nextStatus,
        currentVersion: nextVersionNumber,
        previousFilePaths: previousVersions.map((v) => v.filePath),
        currentFilePath: finalFilePath,
        mergedSourcePaths,
        emailRecipientId: nextApproverId || document.createdById,
      };
    });

    console.info(`[actions] Transaction completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });

    if (result.status === DocumentStatus.REJECTED) {
      await prisma.emailNotificationEvent.updateMany({
        where: {
          documentId,
          emailSent: false,
          type: { in: ["APPROVAL_PENDING", "APPROVAL_OVERDUE"] },
        },
        data: { emailSent: true, claimedAt: null },
      });
    }

    // Clean up all previous version files on disk at every stage so only one file remains
    const filesToClean = [
      ...(result.previousFilePaths || []),
      ...(result.mergedSourcePaths || []),
    ];

    await Promise.all(
      filesToClean.map(async (filePath) => {
        if (filePath === result.currentFilePath) return;
        try {
          await deleteDocumentFiles({ filePaths: [filePath] });
        } catch {
          // Ignore missing files so approval still succeeds.
        }
      }),
    );
    console.info(`[actions] File cleanup completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });

    const documentForEmail = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        documentNumber: true,
        title: true,
        status: true,
        documentType: true,
        mrType: true,
        projectName: true,
        uploaderLocation: true,
        createdAt: true,
        currentApprover: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true, location: true } },
      },
    });

    const workflowRecipientEmails = new Set<string>();
    const creatorEmail = documentForEmail?.createdBy?.email?.trim().toLowerCase();
    const creatorName = documentForEmail?.createdBy?.name?.trim().toLowerCase().replace(/\s+/g, " ");
    const isDispatcherErro = creatorEmail === "dispatcher.pmv@ahmadiah.com" || creatorName === "erro almacen";
    const isAvkUploader = [
      "joemar.paraiso@ahmadiah.com",
      "bernabie.rocha@ahmadiah.com",
      "mohamed.mahran@ahmadiah-sa.com",
    ].includes(creatorEmail || "");

    if (result.status === DocumentStatus.REJECTED) {
      const existingRejectedEmails = documentForEmail?.documentType === "COMPARISON"
        ? ["mohamed.mahmoud@ahmadiah.com", "george.azzi@ahmadiah.com"]
        : ["aqueel.sayed@ahmadiah.com", "george.azzi@ahmadiah.com"];
      existingRejectedEmails.forEach((email) => workflowRecipientEmails.add(email));

      if (documentForEmail?.createdBy?.email) {
        workflowRecipientEmails.add(documentForEmail.createdBy.email.trim().toLowerCase());
      }

      if (documentForEmail?.documentType === "COMPARISON" && creatorEmail) {
        workflowRecipientEmails.add(creatorEmail);
      }

      if (documentForEmail?.documentType === "MATERIAL_REQUISITION") {
        if (isDispatcherErro && creatorEmail) {
          workflowRecipientEmails.add(creatorEmail);
          workflowRecipientEmails.add("mohammad.mehieddine@ahmadiah.com");
        } else if (isAvkUploader && creatorEmail) {
          workflowRecipientEmails.add(creatorEmail);
          workflowRecipientEmails.add("joemar.paraiso@ahmadiah.com");
        }
      }
    }

    if (result.status === DocumentStatus.REVISION_REQUIRED) {
      if (documentForEmail?.currentApprover?.email) {
        workflowRecipientEmails.add(documentForEmail.currentApprover.email.trim().toLowerCase());
      }

      if (documentForEmail?.documentType === "COMPARISON") {
        workflowRecipientEmails.add("mohamed.mahmoud@ahmadiah.com");
      } else if (isDispatcherErro && creatorEmail) {
        workflowRecipientEmails.add(creatorEmail);
        workflowRecipientEmails.add("mohammad.mehieddine@ahmadiah.com");
      } else if (isAvkUploader && creatorEmail) {
        workflowRecipientEmails.add(creatorEmail);
        workflowRecipientEmails.add("joemar.paraiso@ahmadiah.com");
      } else {
        workflowRecipientEmails.add("aqueel.sayed@ahmadiah.com");
      }
    }

    if (workflowRecipientEmails.size > 0) {
      const notificationRecipients = await prisma.user.findMany({
        where: { email: { in: [...workflowRecipientEmails] } },
        select: { id: true },
      });
      const existingNotificationRecipients = new Set<string>([
        result.emailRecipientId,
        documentForEmail?.currentApprover?.id,
      ].filter((userId): userId is string => Boolean(userId)));
      const notificationType = result.status === DocumentStatus.REJECTED
        ? "DOCUMENT_REJECTED" as const
        : "DOCUMENT_REVISED" as const;
      const notificationTitle = result.status === DocumentStatus.REJECTED ? "Document rejected" : "Revision requested";

      runInBackground(async () => {
        await Promise.all(
          notificationRecipients
            .filter((recipient) => !existingNotificationRecipients.has(recipient.id))
            .map((recipient) => createNotification({
              userId: recipient.id,
              type: notificationType,
              title: notificationTitle,
              message: `${documentForEmail?.documentNumber} - ${documentForEmail?.title}`,
              documentId,
            })),
        );
      });
    }

    if (
      documentForEmail?.currentApprover?.email &&
      (result.status === DocumentStatus.PENDING_APPROVER_1 ||
        result.status === DocumentStatus.PENDING_APPROVER_2 ||
        result.status === DocumentStatus.PENDING_APPROVER_3 ||
        result.status === DocumentStatus.REVISION_REQUIRED)
      ){
      const recipients = result.status === DocumentStatus.REVISION_REQUIRED
        ? await prisma.user.findMany({
            where: { email: { in: [...workflowRecipientEmails] } },
            select: { id: true },
          })
        : documentForEmail.currentApprover.id
          ? [{ id: documentForEmail.currentApprover.id }]
          : [];
      if (documentForEmail.createdBy?.id && !recipients.some((recipient) => recipient.id === documentForEmail.createdBy?.id)) {
        recipients.push({ id: documentForEmail.createdBy.id });
      }

      await queueWorkflowEmailEvents(
        recipients.map((recipient) => ({
          recipientId: recipient.id,
          type: "APPROVAL_PENDING" as const,
          documentId,
        })),
      );
    }
    if (result.status === DocumentStatus.APPROVED || result.status === DocumentStatus.REJECTED) {
      const approvedRecipientEmail = documentForEmail?.documentType === "COMPARISON"
        ? ["aqueel.sayed@ahmadiah.com", "mohamed.mahmoud@ahmadiah.com"]
        : ["omar.merzek@ahmadiah.com"];

      const targetEmails = result.status === DocumentStatus.APPROVED
        ? [...approvedRecipientEmail]
        : [...workflowRecipientEmails];

      const avkCompletionEmails = result.status === DocumentStatus.APPROVED
        && documentForEmail != null
        && effectiveDocumentLocation(documentForEmail) === "AVK"
        // KSA project documents (e.g. uploaded by Bernabie) follow the project's emails, like Ready Mix Khobar.
        && !getKsaProjectByName(documentForEmail.projectName)
        && (documentForEmail.documentType === "MATERIAL_REQUISITION" || documentForEmail.documentType === "COMPARISON")
        ? [
          ...(creatorEmail ? [creatorEmail] : []),
            MOHAMED_AVK_WORKFLOW_UPLOADER_EMAIL,
            ...(documentForEmail.documentType === "MATERIAL_REQUISITION" ? ["omar.merzek@ahmadiah.com"] : []),
          ]
        : [];
      avkCompletionEmails.forEach((email) => targetEmails.push(email));

      if (result.status === DocumentStatus.REJECTED && documentForEmail?.createdBy?.email) {
        const uploaderEmail = documentForEmail.createdBy.email.trim().toLowerCase();
        if (!targetEmails.includes(uploaderEmail)) {
          targetEmails.push(uploaderEmail);
        }
      }

      if (
        documentForEmail?.createdBy?.email
        && creatorEmail
        && !targetEmails.includes(creatorEmail)
        && (result.status !== DocumentStatus.APPROVED || documentForEmail.documentType !== "MATERIAL_REQUISITION")
      ) {
        targetEmails.push(creatorEmail);
      }

      const clerkRecipients = await prisma.user.findMany({
        where: {
          email: {
            in: targetEmails,
          },
        },
        select: { id: true, email: true },
      });
      const emailType = result.status === DocumentStatus.APPROVED ? "WORKFLOW_APPROVED" : "WORKFLOW_REJECTED";
      await queueWorkflowEmailEvents(clerkRecipients.map((clerk) => ({ recipientId: clerk.id, type: emailType, documentId })));

      if (avkCompletionEmails.length > 0 && documentForEmail?.createdBy?.id) {
        runInBackground(async () => {
          await Promise.all(
            clerkRecipients
              .filter((recipient) => avkCompletionEmails.includes(recipient.email.trim().toLowerCase()))
              .filter((recipient) => recipient.id !== documentForEmail.createdBy?.id)
              .map((recipient) => createNotification({
                userId: recipient.id,
                type: "DOCUMENT_APPROVED",
                title: "AVK document approved",
                message: `${documentForEmail.documentNumber} - ${documentForEmail.title}`,
                documentId,
              })),
          );
        });
      }
    }

    console.info(`[actions] Queueing completed in ${Math.round(performance.now() - startedAt)}ms`, { documentId, decision });

    const appUrl = appConfig.appUrl();

    const getDocumentTypeLabel = (document: {
      documentType?: string | null;
      mrType?: string | null;
    }) => {
      if (document.documentType === "MATERIAL_REQUISITION") {
        if (document.mrType === "CASH") return "MR Cash";
        if (document.mrType === "CREDIT") return "MR Credit";
        return "MR";
      }

      if (document.documentType === "CUSTODY") {
        return "Custody File";
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
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Comments</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${escapeEmailHtml(comments)}</td>
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
                      <tr>
                        <th align="left" style="padding: 10px; border: 1px solid #e6e6e6; background-color: #f5f5f5;">Comments</th>
                        <td style="padding: 10px; border: 1px solid #e6e6e6;">${escapeEmailHtml(comments)}</td>
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
