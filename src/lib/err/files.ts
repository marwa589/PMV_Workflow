import "server-only";

import { randomUUID } from "node:crypto";
import type { ErrFileKind } from "@prisma/client";
import { saveStoredFile } from "@/lib/files";
import type { ValidatedPdfUpload } from "@/lib/pdf-validation";

export const ERR_PDF_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxPages: 200,
};

export async function saveErrPdf(params: {
  errId: string;
  kind: ErrFileKind;
  pdf: ValidatedPdfUpload;
  storageName?: string;
  storageFolder?: string | null;
  overwrite?: boolean;
}) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(params.errId)) {
    throw new Error("Invalid ERR identifier.");
  }

  const baseName = safeStorageName(params.storageName || params.pdf.originalName);
  const folder = params.kind === "QUOTATION" ? "quotations/" : "";
  const uniqueId = params.errId.slice(0, 8);

  const saved = await saveStoredFile({
    relativePath: `${params.storageFolder ?? "ERRs"}/${folder}${baseName}-${uniqueId}.pdf`,
    bytes: params.pdf.bytes,
    overwrite: params.overwrite ?? true,
  });

  return {
    filePath: saved.relativePath,
    originalName: params.pdf.originalName,
    mimeType: params.pdf.mimeType,
    fileSize: params.pdf.fileSize,
  };
}

export async function saveErrFile(params: {
  errId: string;
  kind: ErrFileKind;
  file: File;
  storageName?: string;
  storageFolder?: string | null;
}) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(params.errId)) {
    throw new Error("Invalid ERR identifier.");
  }

  const extension = params.file.name.includes(".")
    ? `.${params.file.name.split(".").pop()?.toLowerCase()}`
    : "";
  const baseName = safeStorageName(params.storageName || params.file.name);
  const folder = params.kind === "QUOTATION" ? "quotations/" : "";
  const uniqueId = params.errId.slice(0, 8);
  const bytes = new Uint8Array(await params.file.arrayBuffer());

  const saved = await saveStoredFile({
    relativePath: `${params.storageFolder ?? "ERRs"}/${folder}${baseName}-${uniqueId}${extension}`,
    bytes,
    overwrite: true,
  });

  return {
    filePath: saved.relativePath,
    originalName: params.file.name,
    mimeType: params.file.type || "application/octet-stream",
    fileSize: params.file.size,
  };
}

function safeStorageName(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  const safe = withoutExtension.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe.slice(0, 150) || randomUUID();
}