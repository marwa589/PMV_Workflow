import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ErrType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getErrAccess } from "@/lib/err/permissions";
import { saveErrFile } from "@/lib/err/files";
import { deleteDocumentFiles } from "@/lib/files";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";
import { projectStorageFolder } from "@/lib/err-storage";

export const runtime = "nodejs";

class SubmissionError extends Error {}

export async function POST(request: Request) {
  const savedPaths: string[] = [];
  let transactionStarted = false;
  let submissionKey: string | null = null;
  let uploaderId: string | null = null;
  let documentNumber = "";

  try {
    const appUrl = process.env.APP_URL;

    if (!appUrl) {
      throw new Error("APP_URL is missing.");
    }

    if (request.headers.get("origin") !== new URL(appUrl).origin) {
      return NextResponse.json(
        { message: "Request origin is not allowed." },
        { status: 403 },
      );
    }

    const access = await getErrAccess();

    if (!access) {
      return NextResponse.json(
        { message: "Please sign in." },
        { status: 401 },
      );
    }

    if (!access.isAdmin && !access.isUploader && !isErrUploaderAccount(access.name, access.role)) {
      return NextResponse.json(
        { message: "You do not have permission to upload ERRs." },
        { status: 403 },
      );
    }

    uploaderId = access.userId;

    // Early check when the browser supplies Content-Length.
    const lengthHeader = request.headers.get("content-length");

    if (
      lengthHeader &&
      Number(lengthHeader) > 42 * 1024 * 1024
    ) {
      return NextResponse.json(
        { message: "The upload is too large." },
        { status: 413 },
      );
    }

    let form: FormData;

    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { message: "The upload could not be read." },
        { status: 400 },
      );
    }

    const titleValue = form.get("title");
    const descriptionValue = form.get("description");
    const typeValue = form.get("type");
    const projectValue = form.get("projectId");
    const uploadedFiles = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const legacyErrPdf = form.get("errPdf");
    if (legacyErrPdf instanceof File && legacyErrPdf.size > 0) uploadedFiles.unshift(legacyErrPdf);
    const quotation = form.get("quotation");
        const keyValue = form.get("submissionKey");

    if (
      typeof keyValue !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        keyValue,
      )
    ) {
      throw new SubmissionError(
        "The submission key is missing or invalid. Refresh the form.",
      );
    }

    submissionKey = keyValue.toLowerCase();

    const existing = await prisma.err.findUnique({
      where: { submissionKey },
      select: {
        id: true,
        documentNumber: true,
        createdById: true,
      },
    });

    if (existing) {
      if (existing.createdById !== access.userId) {
        return NextResponse.json(
          { message: "This submission key cannot be used." },
          { status: 409 },
        );
      }

      return NextResponse.json({
        message: "This ERR was already submitted.",
        id: existing.id,
        documentNumber: existing.documentNumber,
      });
    }

    if (
      typeof titleValue !== "string" ||
      typeof typeValue !== "string" ||
      typeof projectValue !== "string"
    ) {
      throw new SubmissionError(
        "Title, ERR type, and project are required.",
      );
    }

    const title = titleValue.trim();
    const rawProjectId = projectValue.trim();
    let projectId = rawProjectId;
    let explicitDirectorId: string | null = null;
    if (rawProjectId.includes("::")) {
      const parts = rawProjectId.split("::");
      projectId = parts[0];
      explicitDirectorId = parts[1] || null;
    }
    const requestedDirectorId = form.get("projectDirectorId")?.toString().trim() || explicitDirectorId || null;

    if (!title || title.length > 200) {
      throw new SubmissionError(
        "Enter a title between 1 and 200 characters.",
      );
    }

    if (
      !Object.values(ErrType).includes(typeValue as ErrType)
    ) {
      throw new SubmissionError("Select a valid ERR type.");
    }

    if (!projectId || projectId.length > 100) {
      throw new SubmissionError("Select a valid project.");
    }

    if (uploadedFiles.length === 0) {
      throw new SubmissionError("At least one ERR file is required.");
    }

    const acceptedExtensions = ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png"];
    const filesToValidate = [...uploadedFiles, ...(quotation instanceof File && quotation.size > 0 ? [quotation] : [])];
    for (const file of filesToValidate) {
      const extension = file.name.toLowerCase().split(".").pop() || "";
      if (!acceptedExtensions.includes(extension)) {
        throw new SubmissionError("Unsupported file type. Allowed: PDF, Word, Excel, JPG, JPEG, PNG.");
      }
      if (file.size > 20 * 1024 * 1024) {
        throw new SubmissionError("Each ERR file must be 20 MB or smaller.");
      }
    }

    const storageProject = await prisma.errProject.findFirst({
  where: {
    id: projectId,
    isActive: true,
  },
  select: {
    name: true,
  },
});

if (!storageProject) {
  throw new SubmissionError("Select an existing, active project.");
}

const storageFolder = projectStorageFolder(storageProject.name);
    const errId = randomUUID();

    const errFile = await saveErrFile({
      errId,
      kind: "ERR_PDF",
      file: uploadedFiles[0],
      storageName: title,
      storageFolder,
    });
    savedPaths.push(errFile.filePath);

    const quotationFile = quotation instanceof File && quotation.size > 0
      ? await saveErrFile({
          errId,
          kind: "QUOTATION",
          file: quotation,
          storageName: quotation.name,
          storageFolder,
        })
      : null;
    if (quotationFile) savedPaths.push(quotationFile.filePath);

    transactionStarted = true;

    await prisma.$transaction(
      async (tx) => {
        let sequence = await tx.errSequence.upsert({
          where: { id: 1 },
          update: { nextNumber: { increment: 1 } },
          create: { id: 1, nextNumber: 2 },
          select: { nextNumber: true },
        });
        let assignedNumber = sequence.nextNumber - 1;
        documentNumber = `ERR-${String(assignedNumber).padStart(6, "0")}`;

        while (await tx.err.findUnique({ where: { documentNumber }, select: { id: true } })) {
          sequence = await tx.errSequence.update({
            where: { id: 1 },
            data: { nextNumber: { increment: 1 } },
            select: { nextNumber: true },
          });
          assignedNumber = sequence.nextNumber - 1;
          documentNumber = `ERR-${String(assignedNumber).padStart(6, "0")}`;
        }

        // Recheck permission when creating the records.
        const uploader = access.isAdmin || isErrUploaderAccount(access.name, access.role)
          ? { id: access.userId }
          : await tx.errUserAccess.findFirst({
              where: {
                userId: access.userId,
                role: "UPLOADER",
                isActive: true,
                OR: [{ projectId: null }, { projectId }],
              },
              select: { id: true },
            });

        if (!uploader) {
          throw new SubmissionError(
            "Your upload permission is no longer active.",
          );
        }

        const project = await tx.errProject.findFirst({
          where: {
            id: projectId,
            isActive: true,
            OR: [
              {
                userAccess: {
                  some: {
                    role: "PROJECT_DIRECTOR",
                    isActive: true,
                  },
                },
              },
              {
                director: {
                  is: {
                    errAccess: {
                      some: {
                        role: "PROJECT_DIRECTOR",
                        isActive: true,
                      },
                    },
                  },
                },
              },
            ],
          },
          select: {
            id: true,
            name: true,
            directorId: true,
            userAccess: {
              where: {
                role: "PROJECT_DIRECTOR",
                isActive: true,
              },
              select: { userId: true },
            },
          },
        });

        if (!project) {
          throw new SubmissionError(
            "This project or its director is no longer available.",
          );
        }

        let projectDirectorId: string | null = null;
        if (requestedDirectorId) {
          const isValid =
            project.directorId === requestedDirectorId ||
            project.userAccess.some((u) => u.userId === requestedDirectorId);
          if (isValid) {
            projectDirectorId = requestedDirectorId;
          }
        }
        if (!projectDirectorId) {
          projectDirectorId = project.directorId || project.userAccess[0]?.userId || null;
        }

        if (!projectDirectorId) {
          throw new SubmissionError("No active project director is assigned to this project.");
        }

        await tx.err.create({
          data: {
            id: errId,
            documentNumber,
            submissionKey,
            title,
            description: typeof descriptionValue === "string" && descriptionValue.trim() ? descriptionValue.trim() : null,
            type: typeValue as ErrType,
            status: "PENDING",
            currentStage: "PROJECT_DIRECTOR",
            createdById: access.userId,
            projectId: project.id,
            projectNameSnapshot: project.name,
            projectDirectorId,
            currentApproverId: projectDirectorId,
            currentApproverAssignedAt: new Date(),
          },
        });

        const initialPdf = await tx.errFile.create({
          data: {
            errId,
            kind: "ERR_PDF",
            versionNumber: 1,
            revisionNumber: 1,
            uploadedById: access.userId,
            ...errFile,
          },
        });

        if (quotationFile) {
          await tx.errFile.create({
            data: {
              errId,
              kind: "QUOTATION",
              versionNumber: 1,
              revisionNumber: 1,
              uploadedById: access.userId,
              ...quotationFile,
            },
          });
        }

        const action = await tx.errApprovalHistory.create({
          data: {
            errId,
            performedById: access.userId,
            action: "SUBMITTED",
            stage: "PROJECT_DIRECTOR",
            revisionNumber: 1,
            outputFileId: initialPdf.id,
          },
        });

        await tx.errNotification.create({
          data: {
            errId,
            recipientId: projectDirectorId,
            type: "APPROVAL_PENDING",
            eventKey: action.id,
            title: "ERR awaiting your approval",
            message: `${documentNumber}: ${title}`,
            emailEnabled: false,
          },
        });
      },
      { timeout: 15000 },
    );

    return NextResponse.json(
      {
        message: "ERR submitted to the Project Director.",
        id: errId,
        documentNumber,
      },
      { status: 201 },
    );
  } catch (error) {
        if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      submissionKey &&
      uploaderId
    ) {
      // This transaction failed on a unique constraint.
      // Remove only the new files created by this request.
      await deleteDocumentFiles({ filePaths: savedPaths });

      try {
        const existing = await prisma.err.findUnique({
          where: { submissionKey },
          select: {
            id: true,
            documentNumber: true,
            createdById: true,
          },
        });

        if (existing && existing.createdById === uploaderId) {
          return NextResponse.json({
            message: "This ERR was already submitted.",
            id: existing.id,
            documentNumber: existing.documentNumber,
          });
        }

        if (documentNumber) {
          const existingByNumber = await prisma.err.findUnique({
            where: { documentNumber },
            select: {
              id: true,
              documentNumber: true,
              createdById: true,
            },
          });

          if (existingByNumber && existingByNumber.createdById === uploaderId) {
            return NextResponse.json({
              message: "This ERR was already submitted.",
              id: existingByNumber.id,
              documentNumber: existingByNumber.documentNumber,
            });
          }
        }
      } catch {
        // The database may be unavailable.
        // Keep the response generic.
      }

      const target = error.meta?.target;
      return NextResponse.json(
        {
          message: Array.isArray(target) && target.includes("filePath")
            ? "A file with this title already exists. Rename the file and try again."
            : Array.isArray(target) && target.includes("submissionKey")
              ? "This submission was already received. Check the ERR list before retrying."
              : "Unable to save this ERR. Check the ERR list before retrying.",
        },
        { status: 409 },
      );
    }
    const expectedFailure = error instanceof SubmissionError;

    // Clean up files when failure is known to precede database
    // writes, or an explicit validation error rolled them back.
    if (!transactionStarted || error instanceof SubmissionError) {
      await deleteDocumentFiles({ filePaths: savedPaths });
    }

    // For an unexpected database/connection failure, keep files.
    // A lost response does not prove that the commit failed.
    if (!expectedFailure) {
      console.error("ERR submission failed; inspect server/storage state.", {
        errorCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
        errorMeta: error instanceof Prisma.PrismaClientKnownRequestError ? error.meta : undefined,
      });
    }

    const developmentMessage = process.env.NODE_ENV !== "production" && error instanceof Error
      ? `Unable to save ERR: ${error.message}`
      : "Unable to confirm submission. Check the ERR list before retrying.";

    return NextResponse.json(
      { message: expectedFailure && error instanceof Error ? error.message : developmentMessage },
      { status: expectedFailure ? 400 : 500 },
    );
  }
}