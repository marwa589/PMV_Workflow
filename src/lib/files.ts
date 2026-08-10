import { mkdir, rm, unlink, writeFile } from "fs/promises";
import path from "path";

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

// Compute the structured storage directory based on document type and relationship.
export function resolveStorageDir(params: {
  documentType: "COMPARISON" | "MATERIAL_REQUISITION";
  mrNumber?: string | null;
  hasLinkedComparison: boolean;
}): string {
  if (params.documentType === "COMPARISON") {
    return path.join(process.cwd(), "uploads", "Comparisons");
  }
  if (params.hasLinkedComparison && params.mrNumber) {
    return path.join(process.cwd(), "uploads", "MRs+Comparisons", `MR-${safeFileName(params.mrNumber)}`);
  }
  return path.join(process.cwd(), "uploads", "MRs");
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
    fileName = safeFileName(`${params.documentNumber}-v${params.versionNumber}-${params.file.name}`);
  } else {
    // Legacy fallback path (used during approval actions before full info is available)
    dir = path.join(process.cwd(), "uploads", "documents", params.documentId);
    fileName = `v${params.versionNumber}-${Date.now()}.${extension}`;
  }

  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  await writeFile(fullPath, Buffer.from(await params.file.arrayBuffer()));

  const relativePath = path.relative(process.cwd(), fullPath).replaceAll("\\", "/");
  return { relativePath, extension };
}

// Copy a comparison file into an MRs+Comparisons subfolder so OneDrive sees the pair together.
export async function copyComparisonToMrFolder(params: {
  comparisonFilePath: string;
  comparisonOriginalName: string;
  mrNumber: string;
}): Promise<void> {
  const { readFile } = await import("fs/promises");
  const destDir = path.join(process.cwd(), "uploads", "MRs+Comparisons", `MR-${safeFileName(params.mrNumber)}`);
  await mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, safeFileName(params.comparisonOriginalName));
  try {
    const buffer = await readFile(path.join(process.cwd(), params.comparisonFilePath));
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
        await unlink(path.join(process.cwd(), relativePath));
      } catch {
        // Ignore missing files.
      }
    }),
  );
}
