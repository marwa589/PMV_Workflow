import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { PDFDocument } from "pdf-lib";
import path from "path";
import { replaceFileInGraph, uploadFileToGraph, deleteFileFromGraph, downloadFileFromGraph } from "@/lib/graph-upload";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export function isLocalStorageEnabled(): boolean {
  const value = process.env.PMV_ENABLE_LOCAL_STORAGE?.trim().toLowerCase();
  if (value === undefined || value === "") {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value);
}

export function getUploadRoot(): string {
  const uploadPath = process.env.UPLOAD_PATH?.trim();
  if (!uploadPath) {
    throw new Error("UPLOAD_PATH is not configured.");
  }
  return uploadPath;
}

export function resolveStoredFilePath(storedPath: string): string {
  if (path.isAbsolute(storedPath)) return storedPath;

  const normalizedPath = storedPath.replaceAll("/", path.sep);
  if (normalizedPath.startsWith(`uploads${path.sep}`)) {
    return path.join(process.cwd(), normalizedPath);
  }

  return path.join(getUploadRoot(), normalizedPath);
}

const ACCEPTED_EXTENSIONS = ["pdf", "docx", "xlsx", "jpg", "jpeg", "png"];
const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
];

export function extensionFromName(name: string): string | null {
  const lower = name.toLowerCase();
  const split = lower.split(".");
  if (split.length < 2) return null;
  return split[split.length - 1] || null;
}

export function ensureAllowedFile(file: File): { ok: boolean; message?: string; extension?: string } {
  const extension = extensionFromName(file.name);
  const validExt = extension ? ACCEPTED_EXTENSIONS.includes(extension) : false;
  const validMime = ACCEPTED_MIME_TYPES.includes(file.type);

  if (!validExt && !validMime) {
    return {
      ok: false,
      message: "Unsupported file type. Allowed: PDF, DOCX, XLSX, JPG, JPEG, PNG.",
    };
  }

  return { ok: true, extension: extension || "bin" };
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function documentFileName(fileName: string, identifier: string, extension: string): string {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  return safeFileName(`${baseName}-${identifier}`) + (extension ? `.${extension}` : "");
}

async function readStoredBytesForGraphFallback(storedPath: string): Promise<Buffer> {
  try {
    return await readFile(resolveStoredFilePath(storedPath));
  } catch (localError) {
    const version = await prisma.documentVersion.findFirst({
      where: { filePath: storedPath },
      select: { driveId: true, itemId: true },
    });

    if (version?.driveId && version.itemId) {
      try {
        return await downloadFileFromGraph(version.driveId, version.itemId);
      } catch (graphError) {
        throw new Error(
          `Could not read file from local storage or Graph for '${storedPath}'. Local error: ${localError instanceof Error ? localError.message : String(localError)}. Graph error: ${graphError instanceof Error ? graphError.message : String(graphError)}`,
        );
      }
    }

    throw localError;
  }
}

function graphFolderForDocument(params: {
  documentType?: "COMPARISON" | "MATERIAL_REQUISITION";
  hasLinkedComparison?: boolean;
  mrNumber?: string | null;
}): string {
  if (params.documentType === "COMPARISON") return "Comparisons";
  if (params.hasLinkedComparison) return "MRs+Comparisons";
  return "MRs";
}

// async function uploadAfterLocalSave(buffer: Buffer, fileName: string, folder: string): Promise<void> {
//   try {
//     // await uploadFileToGraph(buffer, fileName, folder);
//     console.info("Graph upload successful", { fileName, folder });
//   } catch (error) {
//     console.error("Graph upload failed after local save", {
//       fileName,
//       folder,
//       error: error instanceof Error ? error.message : String(error),
//     });
//   }
// }

export async function saveUserSignatureFile(params: { userId: string; userName: string; file: File }): Promise<{ relativePath: string }> {
  const extension = params.file.name.includes(".") ? params.file.name.slice(params.file.name.lastIndexOf(".")) : "";
  const fileName = safeFileName(`${params.userName}${extension}`);
  const dir = path.join(getUploadRoot(), "Signatures", params.userId);
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  const buffer = Buffer.from(await params.file.arrayBuffer());
  if (isLocalStorageEnabled()) {
    await writeFile(fullPath, buffer);
  }
  // await uploadAfterLocalSave(buffer, fileName, "Signatures");
  return { relativePath: path.relative(getUploadRoot(), fullPath).replaceAll("\\", "/") };
}

// Compute the structured storage directory based on document type and relationship.
export function resolveStorageDir(params: {
  documentType: "COMPARISON" | "MATERIAL_REQUISITION";
  mrNumber?: string | null;
  hasLinkedComparison: boolean;
}): string {
  if (params.documentType === "COMPARISON") {
    return path.join(getUploadRoot(), "Comparisons");
  }
  if (params.hasLinkedComparison) {
    if (params.mrNumber) {
      return path.join(getUploadRoot(), "MRs+Comparisons", `MR-${safeFileName(params.mrNumber)}`);
    }
    return path.join(getUploadRoot(), "MRs+Comparisons");
  }
  return path.join(getUploadRoot(), "MRs");
}

export async function saveDocumentVersionFile(params: {
  documentId: string;
  versionNumber: number;
  file: File;
  // Structured storage params — when provided, file goes to the right named folder.
  documentType?: "COMPARISON" | "MATERIAL_REQUISITION";
  documentNumber?: string;
  mrNumber?: string | null;
  hasLinkedComparison?: boolean;
}): Promise<{ relativePath: string; extension: string; buffer: Buffer }> {
  const validation = ensureAllowedFile(params.file);
  if (!validation.ok || !validation.extension) {
    throw new Error(validation.message || "Invalid file type.");
  }

  const extension = validation.extension;
  let dir: string;
  let fileName: string;

  if (params.documentType && params.documentNumber) {
    dir = resolveStorageDir({
      documentType: params.documentType,
      mrNumber: params.mrNumber,
      hasLinkedComparison: params.hasLinkedComparison ?? false,
    });
    fileName = documentFileName(params.file.name, `${params.documentNumber}-v${params.versionNumber}`, extension);
  } else {
    // Keep approval uploads in the permanent root when document details are unavailable.
    dir = path.join(getUploadRoot(), "documents", params.documentId);
    fileName = documentFileName(params.file.name, params.documentId, extension);
  }

  await mkdir(dir, { recursive: true });

  const fileBuffer = Buffer.from(await params.file.arrayBuffer());

  const fullPath = path.join(dir, fileName);

  if (isLocalStorageEnabled()) {
    await writeFile(fullPath, fileBuffer);
  }
  // await uploadAfterLocalSave(fileBuffer, fileName, graphFolderForDocument(params));

  const relativePath = path.relative(getUploadRoot(), fullPath).replaceAll("\\", "/");
  return { relativePath, extension, buffer: fileBuffer };
}

export async function uploadSavedFileToGraph(params: {
  relativePath: string;
  fileName: string;
  folder: string;
  documentId?: string | null;
  versionId?: string | null;
  performedById: string;
  context: string;
  replaceGraphMetadata?: { driveId: string; itemId: string } | null;
  buffer?: Buffer;
}): Promise<{ driveId: string; itemId: string; webUrl: string } | null> {
  try {
    const buffer = params.buffer ?? await readStoredBytesForGraphFallback(params.relativePath);

    // If replaceGraphMetadata is provided, replace the existing file; otherwise upload new
    const result = params.replaceGraphMetadata
      ? await replaceFileInGraph(
          buffer,
          params.replaceGraphMetadata.driveId,
          params.replaceGraphMetadata.itemId,
          params.fileName,
        )
      : await uploadFileToGraph(buffer, params.fileName, params.folder);

    if (!result?.driveId || !result?.itemId || !result?.webUrl) {
      throw new Error(`Graph ${params.replaceGraphMetadata ? "file replacement" : "upload"} succeeded but metadata was incomplete for '${params.fileName}'.`);
    }

    const resolvedVersionId = params.versionId ?? await prisma.documentVersion.findFirst({
      where: { filePath: params.relativePath },
      select: { id: true },
    }).then((version) => version?.id ?? null);

    if (!resolvedVersionId) {
      throw new Error(`Graph ${params.replaceGraphMetadata ? "file replacement" : "upload"} succeeded for '${params.fileName}' but no matching DocumentVersion row was found for '${params.relativePath}'.`);
    }

    const updatedVersion = await prisma.documentVersion.update({
      where: { id: resolvedVersionId },
      data: {
        driveId: result.driveId,
        itemId: result.itemId,
        webUrl: result.webUrl,
        graphUploadedAt: new Date(),
      },
      select: {
        id: true,
        driveId: true,
        itemId: true,
        webUrl: true,
        graphUploadedAt: true,
      },
    });

    if (!updatedVersion.driveId || !updatedVersion.itemId || !updatedVersion.webUrl) {
      throw new Error(`Graph metadata write failed for '${params.fileName}' even after ${params.replaceGraphMetadata ? "file replacement" : "upload"}. DB write was incomplete.`);
    }

    await writeAuditLog({
      documentId: params.documentId ?? null,
      performedById: params.performedById,
      action: "GRAPH_UPLOAD_RESULT",
      details: JSON.stringify({
        context: params.context,
        fileName: params.fileName,
        folder: params.folder,
        status: "success",
        operation: params.replaceGraphMetadata ? "replace" : "upload",
        driveId: result.driveId,
        itemId: result.itemId,
        webUrl: result.webUrl,
      }),
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await writeAuditLog({
      documentId: params.documentId ?? null,
      performedById: params.performedById,
      action: "GRAPH_UPLOAD_RESULT",
      details: JSON.stringify({
        context: params.context,
        fileName: params.fileName,
        folder: params.folder,
        status: "failed",
        operation: params.replaceGraphMetadata ? "replace" : "upload",
        error: message,
      }),
    });

    console.error("Graph upload failed after local save", {
      fileName: params.fileName,
      folder: params.folder,
      relativePath: params.relativePath,
      error: message,
    });

    return null;
  }
}

async function fallbackAuditUserId(): Promise<string> {
  const fallbackUser = await prisma.user.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (fallbackUser?.id) {
    return fallbackUser.id;
  }

  throw new Error("No user exists to record Graph audit activity.");
}

async function deleteGraphFilesByLocalPaths(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return;

  const matches = await prisma.documentVersion.findMany({
    where: {
      filePath: { in: filePaths },
    },
    select: {
      id: true,
      documentId: true,
      driveId: true,
      itemId: true,
      filePath: true,
    },
  });

  const performerId = await fallbackAuditUserId().catch(() => null);

  await Promise.all(
    matches.map(async (version) => {
      if (!version.driveId || !version.itemId) return;

      try {
        await deleteFileFromGraph(version.driveId, version.itemId);

        if (performerId) {
          await writeAuditLog({
            documentId: version.documentId ?? null,
            performedById: performerId,
            action: "GRAPH_DELETE_RESULT",
            details: JSON.stringify({
              status: "success",
              versionId: version.id,
              filePath: version.filePath,
              driveId: version.driveId,
              itemId: version.itemId,
            }),
          });
        }

        console.info("Graph delete succeeded after local delete", {
          versionId: version.id,
          filePath: version.filePath,
          driveId: version.driveId,
          itemId: version.itemId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Graph delete failed after local delete", {
          versionId: version.id,
          filePath: version.filePath,
          driveId: version.driveId,
          itemId: version.itemId,
          error: message,
        });

        if (performerId) {
          await writeAuditLog({
            documentId: version.documentId ?? null,
            performedById: performerId,
            action: "GRAPH_DELETE_RESULT",
            details: JSON.stringify({
              status: "failed",
              versionId: version.id,
              filePath: version.filePath,
              driveId: version.driveId,
              itemId: version.itemId,
              error: message,
            }),
          });
        }
      }
    }),
  );
}

export async function mergePdfFiles(params: {
  firstFilePath: string;
  secondFilePath: string;
  fileName: string;
  firstBuffer?: Buffer;
  secondBuffer?: Buffer;
}): Promise<{ relativePath: string; buffer: Buffer }> {
  const [firstBytes, secondBytes] = await Promise.all([
    params.firstBuffer ?? readStoredBytesForGraphFallback(params.firstFilePath),
    params.secondBuffer ?? readStoredBytesForGraphFallback(params.secondFilePath),
  ]);
  const mergedPdf = await PDFDocument.create();
  const [firstPdf, secondPdf] = await Promise.all([
    PDFDocument.load(firstBytes),
    PDFDocument.load(secondBytes),
  ]);

  for (const sourcePdf of [firstPdf, secondPdf]) {
    const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }

  const directory = path.join(getUploadRoot(), "MRs+Comparisons");
  await mkdir(directory, { recursive: true });
  const safeName = `${safeFileName(params.fileName.replace(/\.[^.]+$/, ""))}.pdf`;
  const fullPath = path.join(directory, safeName);
  const buffer = Buffer.from(await mergedPdf.save());
  if (isLocalStorageEnabled()) {
    await writeFile(fullPath, buffer);
  }
  // await uploadAfterLocalSave(Buffer.from(buffer), safeName, "MRs+Comparisons");

  const relativePath = path.relative(getUploadRoot(), fullPath).replaceAll("\\", "/");

  return { relativePath, buffer };
}

// Copy a comparison file into an MRs+Comparisons subfolder so OneDrive sees the pair together.
export async function copyComparisonToMrFolder(params: {
  comparisonFilePath: string;
  comparisonOriginalName: string;
  mrNumber?: string;
}): Promise<void> {
  const { readFile } = await import("fs/promises");
  const destDir = params.mrNumber
    ? path.join(getUploadRoot(), "MRs+Comparisons", `MR-${safeFileName(params.mrNumber)}`)
    : path.join(getUploadRoot(), "MRs+Comparisons");
  await mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, safeFileName(params.comparisonOriginalName));
  try {
    const buffer = await readStoredBytesForGraphFallback(params.comparisonFilePath);
    if (isLocalStorageEnabled()) {
      await writeFile(destPath, buffer);
    }
    const performerId = await fallbackAuditUserId().catch(() => null);
    if (performerId) {
      await uploadSavedFileToGraph({
        relativePath: path.relative(getUploadRoot(), destPath).replaceAll("\\", "/"),
        fileName: path.basename(destPath),
        folder: "MRs+Comparisons",
        performedById: performerId,
        context: "COPY_COMPARISON_TO_MR_FOLDER",
      });
    }
  } catch {
    // Non-critical: if comparison file is missing the copy is skipped silently.
  }
}

// Delete files by their stored relative paths, then remove empty parent dirs.
export async function deleteDocumentFiles(params: { filePaths: string[]; directoryPaths?: string[] } | string): Promise<void> {
  // Accept legacy string (documentId) for the old uploads/documents/{id} directory.
  if (typeof params === "string") {
    const dir = path.join(process.cwd(), "uploads", "documents", params);
    await rm(dir, { recursive: true, force: true });
    return;
  }

  const filePaths = params.filePaths || [];

  if (isLocalStorageEnabled()) {
    await Promise.all(
      filePaths.map(async (relativePath) => {
        try {
          await unlink(resolveStoredFilePath(relativePath));
        } catch {
          // Ignore missing files.
        }
      }),
    );

    await Promise.all(
      (params.directoryPaths || []).map(async (directoryPath) => {
        await rm(path.join(getUploadRoot(), directoryPath), { recursive: true, force: true });
      }),
    );
  }

  void deleteGraphFilesByLocalPaths(filePaths).catch((error) => {
    console.error("Background Graph delete mirror failed", error);
  });
}
