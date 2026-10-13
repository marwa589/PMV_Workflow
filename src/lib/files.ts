import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { PDFDocument } from "pdf-lib";
import path from "path";
import { randomUUID } from "node:crypto";

export function getUploadRoot(): string {
  const uploadPath = process.env.UPLOAD_PATH?.trim();
  if (!uploadPath) {
    throw new Error("UPLOAD_PATH is not configured.");
  }
  return uploadPath;
}
export async function saveStoredFile(params: {
  relativePath: string;
  bytes: Uint8Array;
  overwrite?: boolean;
}): Promise<{ relativePath: string }> {
  const normalized = params.relativePath.replaceAll("\\", "/");

  const segments = normalized.split("/");

  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[:*?"<>|\u0000-\u001f]/.test(segment),
    )
  ) {
    throw new Error("Invalid storage path.");
  }

  const root = path.resolve(getUploadRoot());
  const fullPath = path.resolve(root, ...segments);
  const relativeToRoot = path.relative(root, fullPath);

  if (
    !relativeToRoot ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("File must remain inside the upload directory.");
  }

  await mkdir(path.dirname(fullPath), { recursive: true });

  await writeFile(fullPath, params.bytes, {
    flag: params.overwrite ? "w" : "wx",
  });

  return {
    relativePath: relativeToRoot.replaceAll("\\", "/"),
  };
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

function documentFileName(params: {
  fileName: string;
  documentNumber?: string;
  documentId: string;
  versionNumber: number;
  extension: string;
}): string {
  let baseName = params.fileName.replace(/\.[^.]+$/, "");
  // Clean up any trailing -v[0-9]+, -signed, or existing document numbers from previous saves
  baseName = baseName
    .replace(/-(?:v\d+|DOC-\d+|signed)(?=-|$)/gi, "")
    .replace(/-+$/, "")
    .trim();

  if (!baseName) {
    baseName = "Document";
  }

  const docIdentifier = params.documentNumber || params.documentId;
  const versionSuffix = `-v${params.versionNumber}`;

  return safeFileName(`${baseName}${versionSuffix}-${docIdentifier}`) + (params.extension ? `.${params.extension}` : "");
}

export async function saveUserSignatureFile(params: {
  userId: string;
  userName: string;
  file: File;
}): Promise<{ relativePath: string }> {
  const extension = params.file.name.includes(".")
    ? params.file.name.slice(params.file.name.lastIndexOf("."))
    : "";

  const fileName = safeFileName(
    `${params.userName}-${randomUUID()}${extension}`,
  );

  return saveStoredFile({
    relativePath: `Signatures/${params.userId}/${fileName}`,
    bytes: Buffer.from(await params.file.arrayBuffer()),
  });
}

// Saves one file version. With a storageFolder (see documentStorageFolder) the file goes into that named
// folder; otherwise it goes under documents/{documentId}.
export async function saveDocumentVersionFile(params: {
  documentId: string;
  versionNumber: number;
  file: File;
  documentNumber?: string;
  storageFolder?: string | null;
}): Promise<{ relativePath: string; extension: string; storageFolder: string | null }> {
  const validation = ensureAllowedFile(params.file);
  if (!validation.ok || !validation.extension) {
    throw new Error(validation.message || "Invalid file type.");
  }

  const extension = validation.extension;
  const fileName = documentFileName({
    fileName: params.file.name,
    documentNumber: params.documentNumber,
    documentId: params.documentId,
    versionNumber: params.versionNumber,
    extension,
  });

  const folder =
    params.storageFolder && params.documentNumber
      ? params.storageFolder.replaceAll("\\", "/").replace(/\/+$/, "")
      : null;

  const saved = await saveStoredFile({
    relativePath: `${folder ?? `documents/${params.documentId}`}/${fileName}`,
    bytes: new Uint8Array(await params.file.arrayBuffer()),
    overwrite: true,
  });

  return { relativePath: saved.relativePath, extension, storageFolder: folder };
}

export async function mergePdfFiles(params: {
  firstFilePath: string;
  secondFilePath: string;
  fileName: string;
  storageFolder?: string | null;
  subfolder?: string;
}): Promise<{ relativePath: string }> {
  const [firstBytes, secondBytes] = await Promise.all([
    readFile(resolveStoredFilePath(params.firstFilePath)),
    readFile(resolveStoredFilePath(params.secondFilePath)),
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

  const safeName = `${safeFileName(params.fileName.replace(/\.[^.]+$/, ""))}.pdf`;
  const normalizedStorageFolder = params.storageFolder
    ? params.storageFolder.replace(/\\/g, "/").replace(/\/+$/, "")
    : "Documents";
  const mergedFolder = params.subfolder ?? "Merged";
  const relativePath = `${normalizedStorageFolder}/${mergedFolder}/${safeName}`;
  const saved = await saveStoredFile({
    relativePath,
    bytes: await mergedPdf.save(),
    overwrite: true,
  });

  return {
    relativePath: saved.relativePath,
  };
}

// Delete files by their stored relative paths, then remove empty parent dirs.
export async function deleteDocumentFiles(params: { filePaths: string[]; directoryPaths?: string[] } | string): Promise<void> {
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

  await Promise.all(
    (params.directoryPaths || []).map(async (directoryPath) => {
      await rm(path.join(getUploadRoot(), directoryPath), { recursive: true, force: true });
    }),
  );
}
