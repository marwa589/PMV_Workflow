import "server-only";

import { readFile } from "fs/promises";
import { randomUUID } from "node:crypto";
import { ErrType } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import {
  deleteDocumentFiles,
  resolveStoredFilePath,
  saveStoredFile,
} from "@/lib/files";
import { validatePdfUpload, type ValidatedPdfUpload } from "@/lib/pdf-validation";
import { ERR_PDF_LIMITS } from "@/lib/err/files";

export function isRentalErr(type: ErrType): boolean {
  return type === ErrType.RENTAL_ACTC || type === ErrType.RENTAL_EXTERNAL;
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

function buildMergedFileName(documentNumber: string, title: string): string {
  const cleanTitle = title.replace(/\.pdf$/i, "").trim();
  const safeDoc = safeFileName(documentNumber);
  const safeTitle = safeFileName(cleanTitle);
  return `${safeDoc} - ${safeTitle}.pdf`;
}

export async function saveVoucherFile(params: {
  errId: string;
  voucherType: "RELEASE_VOUCHER" | "RECEIPT_VOUCHER";
  file: File;
  documentNumber: string;
}): Promise<{
  filePath: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  bytes: Uint8Array;
}> {
  const validatedPdf: ValidatedPdfUpload = await validatePdfUpload(
    params.file,
    ERR_PDF_LIMITS,
  );

  const subfolder =
    params.voucherType === "RELEASE_VOUCHER"
      ? "release-vouchers"
      : "receipt-vouchers";

  const safeDoc = safeFileName(params.documentNumber);
  const safeOriginal = safeFileName(
    params.file.name.replace(/\.pdf$/i, ""),
  ).slice(0, 80);
  const fileName = `${safeDoc}-${safeOriginal}-${randomUUID().slice(0, 8)}.pdf`;

  const relativePath = `ERRs/${subfolder}/${fileName}`;

  const saved = await saveStoredFile({
    relativePath,
    bytes: validatedPdf.bytes,
    overwrite: true,
  });

  return {
    filePath: saved.relativePath,
    originalName: params.file.name,
    mimeType: validatedPdf.mimeType,
    fileSize: validatedPdf.fileSize,
    bytes: validatedPdf.bytes,
  };
}

export async function mergeErrWithReleaseVoucher(params: {
  errPdfPath: string;
  voucherBytes: Uint8Array;
  documentNumber: string;
  title: string;
}): Promise<{
  relativePath: string;
  fileSize: number;
  originalName: string;
}> {
  const errPdfBytes = await readFile(resolveStoredFilePath(params.errPdfPath));

  const mergedPdf = await PDFDocument.create();
  const [errDoc, voucherDoc] = await Promise.all([
    PDFDocument.load(errPdfBytes),
    PDFDocument.load(params.voucherBytes),
  ]);

  const errPages = await mergedPdf.copyPages(errDoc, errDoc.getPageIndices());
  errPages.forEach((page) => mergedPdf.addPage(page));

  const voucherPages = await mergedPdf.copyPages(
    voucherDoc,
    voucherDoc.getPageIndices(),
  );
  voucherPages.forEach((page) => mergedPdf.addPage(page));

  const mergedBytes = await mergedPdf.save();
  const fileName = buildMergedFileName(params.documentNumber, params.title);
  const relativePath = `ERR+Release/${fileName}`;

  const saved = await saveStoredFile({
    relativePath,
    bytes: mergedBytes,
    overwrite: true,
  });

  return {
    relativePath: saved.relativePath,
    fileSize: mergedBytes.byteLength,
    originalName: fileName,
  };
}

export async function mergeErrWithReceiptVoucher(params: {
  errReleasePdfPath: string;
  voucherBytes: Uint8Array;
  documentNumber: string;
  title: string;
  previousGeneratedPath?: string | null;
}): Promise<{
  relativePath: string;
  fileSize: number;
  originalName: string;
}> {
  const errReleaseBytes = await readFile(
    resolveStoredFilePath(params.errReleasePdfPath),
  );

  const mergedPdf = await PDFDocument.create();
  const [releaseDoc, voucherDoc] = await Promise.all([
    PDFDocument.load(errReleaseBytes),
    PDFDocument.load(params.voucherBytes),
  ]);

  const releasePages = await mergedPdf.copyPages(
    releaseDoc,
    releaseDoc.getPageIndices(),
  );
  releasePages.forEach((page) => mergedPdf.addPage(page));

  const voucherPages = await mergedPdf.copyPages(
    voucherDoc,
    voucherDoc.getPageIndices(),
  );
  voucherPages.forEach((page) => mergedPdf.addPage(page));

  const mergedBytes = await mergedPdf.save();
  const fileName = buildMergedFileName(params.documentNumber, params.title);
  const relativePath = `ERR+Release+Receipt/${fileName}`;

  const saved = await saveStoredFile({
    relativePath,
    bytes: mergedBytes,
    overwrite: true,
  });

  // Clean up intermediate ERR+Release merged file if it exists
  if (
    params.previousGeneratedPath &&
    params.previousGeneratedPath.startsWith("ERR+Release/")
  ) {
    try {
      await deleteDocumentFiles({
        filePaths: [params.previousGeneratedPath],
      });
    } catch {
      // Non-fatal if previous file was already removed
    }
  }

  return {
    relativePath: saved.relativePath,
    fileSize: mergedBytes.byteLength,
    originalName: fileName,
  };
}
