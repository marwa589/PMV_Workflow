import "server-only";

import { randomUUID } from "node:crypto";
import { ErrType } from "@prisma/client";
import { saveStoredFile } from "@/lib/files";
import { validatePdfUpload, type ValidatedPdfUpload } from "@/lib/pdf-validation";
import { ERR_PDF_LIMITS } from "@/lib/err/files";

export function isRentalErr(type: ErrType): boolean {
  return type === ErrType.RENTAL_ACTC || type === ErrType.RENTAL_EXTERNAL;
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

export async function saveVoucherFile(params: {
  errId: string;
  voucherType: "RELEASE_VOUCHER" | "RECEIPT_VOUCHER";
  file: File;
  documentNumber: string;
  storageFolder?: string | null;
}): Promise<{
  filePath: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storageFolder: string | null;
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

  const relativePath =
  `${params.storageFolder ?? "ERRs"}/${subfolder}/${fileName}`;

  const saved = await saveStoredFile({
    relativePath,
    bytes: validatedPdf.bytes,
    overwrite: true,
  });

  return {
    filePath: saved.relativePath,
    storageFolder: params.storageFolder ?? null,
    originalName: params.file.name,
    mimeType: validatedPdf.mimeType,
    fileSize: validatedPdf.fileSize,
    bytes: validatedPdf.bytes,
  };
}
