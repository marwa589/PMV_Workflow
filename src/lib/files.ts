import { mkdir, rm, unlink, writeFile } from "fs/promises";
import path from "path";

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

export async function saveUserSignatureFile(params: { userId: string; userName: string; file: File }): Promise<{ relativePath: string }> {
  const extension = params.file.name.includes(".") ? params.file.name.slice(params.file.name.lastIndexOf(".")) : "";
  const fileName = safeFileName(`${params.userName}${extension}`);
  const dir = path.join(getUploadRoot(), "Signatures", params.userId);
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  await writeFile(fullPath, Buffer.from(await params.file.arrayBuffer()));
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
  if (params.hasLinkedComparison && params.mrNumber) {
    return path.join(getUploadRoot(), "MRs+Comparisons", `MR-${safeFileName(params.mrNumber)}`);
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
}): Promise<{ relativePath: string; extension: string }> {
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
    fileName = documentFileName(params.file.name, params.documentNumber, extension);
  } else {
    // Keep approval uploads in the permanent root when document details are unavailable.
    dir = path.join(getUploadRoot(), "documents", params.documentId);
    fileName = documentFileName(params.file.name, params.documentId, extension);
  }

  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  await writeFile(fullPath, Buffer.from(await params.file.arrayBuffer()));

  const relativePath = path.relative(getUploadRoot(), fullPath).replaceAll("\\", "/");
  return { relativePath, extension };
}

// Copy a comparison file into an MRs+Comparisons subfolder so OneDrive sees the pair together.
export async function copyComparisonToMrFolder(params: {
  comparisonFilePath: string;
  comparisonOriginalName: string;
  mrNumber: string;
}): Promise<void> {
  const { readFile } = await import("fs/promises");
  const destDir = path.join(getUploadRoot(), "MRs+Comparisons", `MR-${safeFileName(params.mrNumber)}`);
  await mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, safeFileName(params.comparisonOriginalName));
  try {
    const buffer = await readFile(resolveStoredFilePath(params.comparisonFilePath));
    await writeFile(destPath, buffer);
  } catch {
    // Non-critical: if comparison file is missing the copy is skipped silently.
  }
}

// Delete files by their stored relative paths, then remove empty parent dirs.
export async function deleteDocumentFiles(params: { filePaths: string[] } | string): Promise<void> {
  // Accept legacy string (documentId) for the old uploads/documents/{id} directory.
  if (typeof params === "string") {
    const dir = path.join(process.cwd(), "uploads", "documents", params);
    await rm(dir, { recursive: true, force: true });
    return;
  }

  await Promise.all(
    params.filePaths.map(async (relativePath) => {
      try {
        await unlink(resolveStoredFilePath(relativePath));
      } catch {
        // Ignore missing files.
      }
    }),
  );
}
