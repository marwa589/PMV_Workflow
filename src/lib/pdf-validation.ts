import "server-only";

import { PDFDocument } from "pdf-lib";

export class PdfValidationError extends Error {}

export async function validatePdfUpload(
  file: File,
  options: {
    maxBytes: number;
    maxPages: number;
  },
) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new PdfValidationError("Please upload a PDF file.");
  }

  if (file.size === 0) {
    throw new PdfValidationError("The PDF is empty.");
  }

  if (file.size > options.maxBytes) {
    const limitMb = Math.floor(options.maxBytes / (1024 * 1024));

    throw new PdfValidationError(
      `Each PDF must be no larger than ${limitMb} MB.`,
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new PdfValidationError("The file is not a valid PDF.");
  }

  let pdf: PDFDocument;

  try {
    pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
    });
  } catch {
    throw new PdfValidationError(
      "The PDF could not be opened. Upload a valid, unencrypted PDF.",
    );
  }

  const pageCount = pdf.getPageCount();

  if (pageCount < 1 || pageCount > options.maxPages) {
    throw new PdfValidationError(
      `Each PDF must contain between 1 and ${options.maxPages} pages.`,
    );
  }

  return {
    bytes,
    originalName: file.name
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
      .slice(0, 200),
    mimeType: "application/pdf",
    fileSize: bytes.length,
  };
}

export type ValidatedPdfUpload = Awaited<
  ReturnType<typeof validatePdfUpload>
>;