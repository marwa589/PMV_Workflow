import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getErrAccess, canApproveErr } from "@/lib/err/permissions";
import {
  ERR_PDF_LIMITS,
  saveErrFile,
  saveErrPdf,
} from "@/lib/err/files";
import { deleteDocumentFiles } from "@/lib/files";
import {
  PdfValidationError,
  validatePdfUpload,
} from "@/lib/pdf-validation";
import { getNextErrStage, resolveErrApprover } from "@/lib/err/workflow";
import { projectStorageFolderFromFile } from "@/lib/err-storage";
import { getRequestOrigin } from "@/lib/request-origin";
import { appConfig } from "@/lib/env";
import { sendEmail } from "@/lib/mail";
import { runInBackground } from "@/lib/background";
// semd err to uploaders
import { isErrUploaderAccount } from "@/lib/err/uploader-access";
import {
  buildApprovalAssignedEmail,
  buildDocumentRejectedEmail,
  buildErrOnHoldEmail,
  buildFinalApprovalEmail,
  buildRevisionRequiredEmail,
} from "@/lib/email-templates";

export const runtime = "nodejs";

class ErrActionError extends Error {}

type Decision = "APPROVE" | "REJECT" | "COMMENT" | "HOLD";
type ApprovalRoute = "FINALIZE" | "ACTING_CEO" | "ACTING_CEO_THEN_CEO";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await getErrAccess();

  if (!access) {
    return NextResponse.json(
      { message: "Please sign in." },
      { status: 401 },
    );
  }

  const { id } = await params;

  if (!(await canApproveErr(access, id))) {
    return NextResponse.json(
      { message: "You are not authorized to act on this ERR." },
      { status: 403 },
    );
  }

  const errForStorage = await prisma.err.findUnique({
  where: { id },
  select: {
    title: true,
    files: {
      where: { kind: "ERR_PDF" },
      orderBy: [
        { versionNumber: "desc" },
        { createdAt: "desc" },
      ],
      take: 1,
      select: { filePath: true, storageFolder: true },
    },
  },
});

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { message: "The review payload could not be read." },
      { status: 400 },
    );
  }

  const decision = String(formData.get("decision") || "")
    .trim()
    .toUpperCase() as Decision;
  const approvalRoute = String(formData.get("approvalRoute") || "")
    .trim()
    .toUpperCase() as ApprovalRoute | "";
  const comments = String(formData.get("comments") || "").trim();
  const fileValue = formData.get("file");
  const file = fileValue instanceof File ? fileValue : null;
  const quotationValue = formData.get("quotation");
  const quotationFile = quotationValue instanceof File && quotationValue.size > 0 ? quotationValue : null;
  const signatureCount = Number(formData.get("signatureCount") || 0);

  if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "COMMENT" && decision !== "HOLD") {
    return NextResponse.json(
      { message: "Decision must be APPROVE, REJECT, or COMMENT." },
      { status: 400 },
    );
  }

  if (decision === "APPROVE" && !file) {
    return NextResponse.json(
      { message: "A signed PDF is required to approve an ERR." },
      { status: 400 },
    );
  }

  if (quotationFile && !access.isPmvManager) {
    return NextResponse.json(
      { message: "Only the PMV Manager can add quotations during ERR review." },
      { status: 403 },
    );
  }

  if (quotationFile) {
    const extension = quotationFile.name.toLowerCase().split(".").pop() || "";
    if (!["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png"].includes(extension)) {
      return NextResponse.json({ message: "Unsupported quotation file type." }, { status: 400 });
    }
    if (quotationFile.size > 20 * 1024 * 1024) {
      return NextResponse.json({ message: "The quotation must be 20 MB or smaller." }, { status: 400 });
    }
  }

  let validatedSignedPdf: Awaited<ReturnType<typeof validatePdfUpload>> | null = null;
  let savedSignedPdf: Awaited<ReturnType<typeof saveErrPdf>> | null = null;
  const savedPaths: string[] = [];

  if (decision === "APPROVE") {
    const signedFile = file;

    if (!signedFile) {
      return NextResponse.json(
        { message: "A signed PDF is required to approve an ERR." },
        { status: 400 },
      );
    }

    try {
      validatedSignedPdf = await validatePdfUpload(signedFile, ERR_PDF_LIMITS);
      savedSignedPdf = await saveErrPdf({
        errId: id,
        kind: "ERR_PDF",
        pdf: validatedSignedPdf,
        storageName: errForStorage?.title || id,
        storageFolder: errForStorage?.files[0]?.storageFolder || projectStorageFolderFromFile(errForStorage?.files[0]?.filePath),
        overwrite: true,
      });
      savedPaths.push(savedSignedPdf.filePath);
    } catch (error) {
      if (error instanceof PdfValidationError) {
        return NextResponse.json(
          { message: error.message },
          { status: 400 },
        );
      }

      console.error("ERR approval PDF preparation failed.", error);
      return NextResponse.json(
        { message: "Unable to prepare the signed ERR PDF." },
        { status: 500 },
      );
    }
  }

  let savedQuotation: Awaited<ReturnType<typeof saveErrFile>> | null = null;
  if (quotationFile) {
    try {
      savedQuotation = await saveErrFile({
        errId: id,
        kind: "QUOTATION",
        file: quotationFile,
        storageName: quotationFile.name,
        storageFolder: errForStorage?.files[0]?.storageFolder || projectStorageFolderFromFile(errForStorage?.files[0]?.filePath),
      });
      savedPaths.push(savedQuotation.filePath);
    } catch (error) {
      console.error("ERR quotation preparation failed.", error);
      return NextResponse.json({ message: "Unable to prepare the quotation." }, { status: 500 });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const err = await tx.err.findUnique({
        where: { id },
        select: {
          id: true,
          documentNumber: true,
          title: true,
          type: true,
          status: true,
          currentStage: true,
          nextApprovalPath: true,
          currentApproverId: true,
          createdById: true,
          projectDirectorId: true,
          projectId: true,
          revisionNumber: true,
          lockVersion: true,
          files: {
            where: { kind: "ERR_PDF" },
            orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: {
              id: true,
              versionNumber: true,
            },
          },
        },
      });

      if (!err) {
        throw new ErrActionError("ERR not found.");
      }

      if (err.status !== "PENDING") {
        throw new ErrActionError("This ERR is no longer pending action.");
      }

      if (err.currentApproverId !== access.userId) {
        throw new ErrActionError("This ERR is not assigned to you.");
      }

      if (savedQuotation && err.currentStage !== "PMV_MANAGER") {
        throw new ErrActionError("Quotations can only be added during PMV Manager review.");
      }

      if (savedQuotation) {
        const quotationCount = await tx.errFile.count({
          where: { errId: err.id, kind: "QUOTATION" },
        });
        await tx.errFile.create({
          data: {
            errId: err.id,
            kind: "QUOTATION",
            versionNumber: quotationCount + 1,
            revisionNumber: err.revisionNumber,
            filePath: savedQuotation.filePath,
            storageFolder: savedQuotation.storageFolder,
            originalName: savedQuotation.originalName,
            mimeType: savedQuotation.mimeType,
            fileSize: savedQuotation.fileSize,
            uploadedById: access.userId,
          },
        });
      }

      const latestErrPdf = err.files[0] ?? null;
      const nextVersionNumber = (latestErrPdf?.versionNumber ?? 0) + 1;
      const now = new Date();

      if (decision === "HOLD") {
        await tx.err.update({
          where: { id: err.id },
          data: {
            status: "ON_HOLD",
            currentApproverAssignedAt: now,
            lockVersion: { increment: 1 },
          },
        });

        await tx.errApprovalHistory.create({
          data: {
            errId: err.id,
            performedById: access.userId,
            action: "PUT_ON_HOLD",
            stage: err.currentStage,
            comments: comments || null,
            revisionNumber: err.revisionNumber,
            inputFileId: latestErrPdf?.id ?? null,
          },
        });

        await tx.errNotification.create({
          data: {
            errId: err.id,
            recipientId: err.createdById,
            type: "ON_HOLD",
            eventKey: `err:${err.id}:on-hold:${randomUUID()}`,
            title: "ERR placed on hold",
            message: `${err.documentNumber}: ${err.title}`,
            emailEnabled: false,
          },
        });

        return { status: "ON_HOLD", message: "ERR placed on hold." };
      }

      if (decision === "APPROVE") {
        if (!savedSignedPdf) {
          throw new ErrActionError("A signed PDF is required to approve this ERR.");
        }

        const pendingRoute = err.currentStage === "PMV_MANAGER"
          ? approvalRoute || "FINALIZE"
          : err.currentStage === "ACTING_CEO"
            ? err.nextApprovalPath || "FINALIZE"
            : "FINALIZE";

        const selectedRoute: ApprovalRoute = pendingRoute === "ACTING_CEO_THEN_CEO"
          ? "ACTING_CEO_THEN_CEO"
          : pendingRoute === "ACTING_CEO"
            ? "ACTING_CEO"
            : "FINALIZE";

        const outputFile = latestErrPdf
          ? await tx.errFile.update({
              where: { id: latestErrPdf.id },
              data: {
                versionNumber: nextVersionNumber,
                revisionNumber: err.revisionNumber,
                filePath: savedSignedPdf.filePath,
                  storageFolder: savedSignedPdf.storageFolder,
                originalName: savedSignedPdf.originalName,
                mimeType: savedSignedPdf.mimeType,
                fileSize: savedSignedPdf.fileSize,
                uploadedById: access.userId,
              },
            })
          : await tx.errFile.create({
              data: {
            errId: err.id,
            kind: "ERR_PDF",
            versionNumber: nextVersionNumber,
            revisionNumber: err.revisionNumber,
            filePath: savedSignedPdf.filePath,
            storageFolder: savedSignedPdf.storageFolder,
            originalName: savedSignedPdf.originalName,
            mimeType: savedSignedPdf.mimeType,
            fileSize: savedSignedPdf.fileSize,
            uploadedById: access.userId,
              },
            });

        const nextStage = err.currentStage === "PMV_MANAGER"
          ? selectedRoute === "ACTING_CEO" || selectedRoute === "ACTING_CEO_THEN_CEO" ? "ACTING_CEO" : null
          : err.currentStage === "ACTING_CEO"
            ? selectedRoute === "ACTING_CEO_THEN_CEO" ? "CEO" : null
            : err.currentStage === "CEO"
              ? null
              : getNextErrStage(err.type, err.currentStage);

        let nextApproverId: string | null = null;
        let nextStatus: "PENDING" | "APPROVED" = "APPROVED";
        let nextStageValue = err.currentStage;
        let approvedAt: Date | null = null;

        if (nextStage) {
          nextApproverId = await resolveErrApprover(
            tx,
            nextStage,
            err.projectDirectorId,
            err.projectId,
          );
          nextStageValue = nextStage;
          nextStatus = "PENDING";
        } else {
          approvedAt = now;
          nextStageValue = err.currentStage;
        }

        await tx.err.update({
          where: { id: err.id },
          data: {
            status: nextStatus,
            currentStage: nextStageValue,
            nextApprovalPath: err.currentStage === "PMV_MANAGER"
              ? selectedRoute === "ACTING_CEO" || selectedRoute === "ACTING_CEO_THEN_CEO"
                ? selectedRoute
                : null
              : err.currentStage === "ACTING_CEO"
                ? null
                : err.nextApprovalPath,
            currentApproverId: nextApproverId,
            currentApproverAssignedAt: nextApproverId ? now : null,
            approvedAt,
            lockVersion: { increment: 1 },
          },
        });

        await tx.errApprovalHistory.create({
          data: {
            errId: err.id,
            performedById: access.userId,
            action: err.currentStage === "PROJECT_DIRECTOR"
              ? "APPROVED"
              : err.currentStage === "ACTING_CEO" && selectedRoute === "ACTING_CEO_THEN_CEO"
                ? "ESCALATED_TO_CEO"
                : selectedRoute === "ACTING_CEO" || selectedRoute === "ACTING_CEO_THEN_CEO"
                  ? "ESCALATED_TO_ACTING_CEO"
                  : "FINALIZED_APPROVAL",
            stage: err.currentStage,
            comments: comments || null,
            revisionNumber: err.revisionNumber,
            inputFileId: latestErrPdf?.id ?? null,
            outputFileId: outputFile.id,
          },
        });

        if (nextApproverId) {
          await tx.errNotification.create({
            data: {
              errId: err.id,
              recipientId: nextApproverId,
              type: "APPROVAL_PENDING",
              eventKey: `err:${err.id}:approval:${randomUUID()}`,
              title: "ERR awaiting your approval",
              message: `${err.documentNumber}: ${err.title}`,
              emailEnabled: false,
            },
          });
        } else {
          await tx.errNotification.create({
            data: {
              errId: err.id,
              recipientId: err.createdById,
              type: "APPROVED",
              eventKey: `err:${err.id}:approved:${randomUUID()}`,
              title: "ERR approved",
              message: `${err.documentNumber}: ${err.title}`,
              emailEnabled: false,
            },
          });
        }

        return {
          status: nextStatus,
          message: nextStage
            ? "ERR advanced to the next approval stage."
            : "ERR finalized and approved.",
        };
      }

      if (decision === "REJECT") {
        await tx.err.update({
          where: { id: err.id },
          data: {
            status: "REJECTED",
            currentApproverId: null,
            currentApproverAssignedAt: null,
            lockVersion: { increment: 1 },
          },
        });

        await tx.errApprovalHistory.create({
          data: {
            errId: err.id,
            performedById: access.userId,
            action: "REJECTED",
            stage: err.currentStage,
            comments: comments || null,
            revisionNumber: err.revisionNumber,
            inputFileId: latestErrPdf?.id ?? null,
          },
        });

        await tx.errNotification.create({
          data: {
            errId: err.id,
            recipientId: err.createdById,
            type: "REJECTED",
            eventKey: `err:${err.id}:rejected:${randomUUID()}`,
            title: "ERR rejected",
            message: `${err.documentNumber}: ${err.title}`,
            emailEnabled: false,
          },
        });

        return {
          status: "REJECTED",
          message: "ERR rejected.",
        };
      }

      await tx.err.update({
        where: { id: err.id },
        data: {
          status: "REVISION_REQUIRED",
          currentApproverId: err.createdById,
          currentApproverAssignedAt: now,
          lockVersion: { increment: 1 },
        },
      });

      await tx.errApprovalHistory.create({
        data: {
          errId: err.id,
          performedById: access.userId,
          action: "REQUESTED_REVISION",
          stage: err.currentStage,
          comments: comments || null,
          revisionNumber: err.revisionNumber,
          inputFileId: latestErrPdf?.id ?? null,
        },
      });

      await tx.errNotification.create({
        data: {
          errId: err.id,
          recipientId: err.createdById,
          type: "REVISION_REQUIRED",
          eventKey: `err:${err.id}:revision:${randomUUID()}`,
          title: "ERR requires revision",
          message: `${err.documentNumber}: ${err.title}`,
          emailEnabled: false,
        },
      });

      return {
        status: "REVISION_REQUIRED",
        message: "ERR returned for revision.",
      };
    });

    if (result.status === "PENDING") {
      runInBackground(async () => {
        try {
          const pendingErr = await prisma.err.findUnique({
            where: { id },
            select: {
              documentNumber: true,
              title: true,
              type: true,
              projectNameSnapshot: true,
              currentApprover: { select: { name: true, email: true } },
            },
          });

          if (pendingErr?.currentApprover?.email) {
            const emailContext = {
              recipientName: pendingErr.currentApprover.name,
              docNumber: pendingErr.documentNumber,
              title: pendingErr.title,
              workflowType: `ERR - ${pendingErr.type}`,
              projectName: pendingErr.projectNameSnapshot,
              currentStatus: result.status,
              actorName: access.name,
              comments: comments || null,
              documentUrl: new URL(`/errs/${id}`, appConfig.appUrl()).toString(),
            };
            const template = buildApprovalAssignedEmail(emailContext);

            await sendEmail({
              to: pendingErr.currentApprover.email,
              subject: template.subject,
              html: template.html,
            });
          }
        } catch (error) {
          console.error("ERR next approver email could not be sent.", error);
        }
      });
    } else {
      runInBackground(async () => {
        try {
        const errForEmail = await prisma.err.findUnique({
          where: { id },
          select: {
            documentNumber: true,
            title: true,
            type: true,
            projectNameSnapshot: true,
            createdBy: { select: { location: true } },
          },
        });

        const uploaderUsers = await prisma.user.findMany({
          where: {
            OR: [
              { errAccess: { some: { role: "UPLOADER", isActive: true } } },
              { role: "ERR_USER" },
            ],
          },
          select: {
            name: true,
            email: true,
            role: true,
            location: true,
            errAccess: {
              where: { role: "UPLOADER", isActive: true },
              select: { id: true },
            },
          },
        });
        const uploaderIsKuwait = errForEmail?.createdBy.location === "KUWAIT";
        const recipients = uploaderUsers.filter((user) =>
          user.email && (
            user.errAccess?.length > 0 || isErrUploaderAccount(user.name, user.role)
          ) && (
            uploaderIsKuwait
              ? user.location === "KUWAIT"
              : user.location !== "KUWAIT"
          ),
        );

        if (errForEmail && recipients.length > 0) {
          const templateForRecipient = (recipient: { name: string; email: string }) => {
            const emailContext = {
              recipientName: recipient.name,
              docNumber: errForEmail.documentNumber,
              title: errForEmail.title,
              workflowType: `ERR - ${errForEmail.type}`,
              projectName: errForEmail.projectNameSnapshot,
              currentStatus: result.status,
              actorName: access.name,
              comments: comments || null,
              documentUrl: new URL(`/errs/${id}`, appConfig.appUrl()).toString(),
            };
            const template = result.status === "APPROVED"
              ? buildFinalApprovalEmail(emailContext)
              : result.status === "REJECTED"
                ? buildDocumentRejectedEmail(emailContext)
                : result.status === "REVISION_REQUIRED"
                  ? buildRevisionRequiredEmail(emailContext)
                  : buildErrOnHoldEmail(emailContext);

            return sendEmail({
              to: recipient.email,
              subject: template.subject,
              html: template.html,
            });
          };

          for (const recipient of recipients) {
            await templateForRecipient(recipient);
          }
        }
        } catch (error) {
          console.error("ERR uploader email could not be sent.", error);
        }
      });
    }

    return NextResponse.json(
      { message: result.message, status: result.status },
      { status: 200 },
    );
  } catch (error) {
    if (savedPaths.length > 0) {
      const previousFilePath = errForStorage?.files[0]?.filePath;
      const pathsToDelete = savedPaths.filter((filePath) => filePath !== previousFilePath);
      if (pathsToDelete.length > 0) {
        await deleteDocumentFiles({ filePaths: pathsToDelete });
      }
    }

    if (error instanceof ErrActionError) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 },
      );
    }

    console.error("ERR action could not be processed.", error);

    return NextResponse.json(
      { message: "Unable to process this ERR action." },
      { status: 500 },
    );
  }
}
