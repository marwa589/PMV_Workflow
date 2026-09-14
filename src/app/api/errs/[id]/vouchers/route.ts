import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canUploadErrVoucher,
  canViewErr,
  getErrAccess,
} from "@/lib/err/permissions";
import {
  isRentalErr,
  mergeErrWithReceiptVoucher,
  mergeErrWithReleaseVoucher,
  saveVoucherFile,
} from "@/lib/err/vouchers";
import { PdfValidationError } from "@/lib/pdf-validation";

export const runtime = "nodejs";

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

  if (!(await canViewErr(access, id))) {
    return NextResponse.json(
      { message: "You are not authorized to view this ERR." },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { message: "Invalid form data." },
      { status: 400 },
    );
  }

  const voucherType = String(formData.get("voucherType") || "").trim().toUpperCase();
  const comments = String(formData.get("comments") || "").trim();
  const fileValue = formData.get("file");

  if (voucherType !== "RELEASE_VOUCHER" && voucherType !== "RECEIPT_VOUCHER") {
    return NextResponse.json(
      { message: "Invalid voucher type. Must be RELEASE_VOUCHER or RECEIPT_VOUCHER." },
      { status: 400 },
    );
  }

  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return NextResponse.json(
      { message: "Please select a voucher PDF to upload." },
      { status: 400 },
    );
  }

  const err = await prisma.err.findUnique({
    where: { id },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      type: true,
      status: true,
      projectId: true,
      revisionNumber: true,
      files: {
        select: {
          id: true,
          kind: true,
          filePath: true,
          versionNumber: true,
          originalName: true,
        },
        orderBy: { versionNumber: "desc" },
      },
    },
  });

  if (!err) {
    return NextResponse.json(
      { message: "ERR not found." },
      { status: 404 },
    );
  }

  if (!canUploadErrVoucher(access, err.projectId)) {
    return NextResponse.json(
      { message: "You are not authorized to upload vouchers for this ERR." },
      { status: 403 },
    );
  }

  if (!isRentalErr(err.type)) {
    return NextResponse.json(
      { message: "Vouchers can only be added to rental ERRs." },
      { status: 400 },
    );
  }

  if (err.status !== "APPROVED") {
    return NextResponse.json(
      { message: "Vouchers can only be added to approved ERRs." },
      { status: 400 },
    );
  }

  const hasReleaseVoucher = err.files.some((f) => f.kind === "RELEASE_VOUCHER");
  const hasReceiptVoucher = err.files.some((f) => f.kind === "RECEIPT_VOUCHER");

  if (voucherType === "RELEASE_VOUCHER") {
    if (hasReleaseVoucher) {
      return NextResponse.json(
        { message: "A release voucher has already been added to this ERR." },
        { status: 400 },
      );
    }
  } else if (voucherType === "RECEIPT_VOUCHER") {
    if (!hasReleaseVoucher) {
      return NextResponse.json(
        { message: "A release voucher must be added before adding a receipt voucher." },
        { status: 400 },
      );
    }
    if (hasReceiptVoucher) {
      return NextResponse.json(
        { message: "A receipt voucher has already been added to this ERR." },
        { status: 400 },
      );
    }
  }

  const latestErrPdf = err.files.find((f) => f.kind === "ERR_PDF");
  if (!latestErrPdf) {
    return NextResponse.json(
      { message: "Original ERR PDF not found." },
      { status: 400 },
    );
  }

  try {
    if (voucherType === "RELEASE_VOUCHER") {
      // 1. Save release voucher file
      const savedVoucher = await saveVoucherFile({
        errId: err.id,
        voucherType: "RELEASE_VOUCHER",
        file: fileValue,
        documentNumber: err.documentNumber,
      });

      // 2. Merge approved ERR PDF with release voucher
      const merged = await mergeErrWithReleaseVoucher({
        errPdfPath: latestErrPdf.filePath,
        voucherBytes: savedVoucher.bytes,
        documentNumber: err.documentNumber,
        title: err.title,
      });

      // 3. Database transaction
      await prisma.$transaction(async (tx) => {
        const voucherRecord = await tx.errFile.create({
          data: {
            errId: err.id,
            kind: "RELEASE_VOUCHER",
            versionNumber: 1,
            revisionNumber: err.revisionNumber,
            filePath: savedVoucher.filePath,
            originalName: savedVoucher.originalName,
            mimeType: savedVoucher.mimeType,
            fileSize: savedVoucher.fileSize,
            uploadedById: access.userId,
          },
        });

        const nextVersion = latestErrPdf.versionNumber + 1;
        const updatedErrPdf = await tx.errFile.update({
          where: { id: latestErrPdf.id },
          data: {
            versionNumber: nextVersion,
            filePath: merged.relativePath,
            originalName: merged.originalName,
            mimeType: "application/pdf",
            fileSize: merged.fileSize,
            uploadedById: access.userId,
          },
        });

        await tx.errApprovalHistory.create({
          data: {
            errId: err.id,
            performedById: access.userId,
            action: "RELEASE_VOUCHER_ADDED",
            comments: comments || "Release voucher added and merged into ERR+Release package.",
            revisionNumber: err.revisionNumber,
            inputFileId: voucherRecord.id,
            outputFileId: updatedErrPdf.id,
          },
        });
      });

      return NextResponse.json({
        success: true,
        message: "Release voucher uploaded and merged successfully into ERR+Release.",
      });
    } else {
      // voucherType === "RECEIPT_VOUCHER"
      // 1. Save receipt voucher file
      const savedVoucher = await saveVoucherFile({
        errId: err.id,
        voucherType: "RECEIPT_VOUCHER",
        file: fileValue,
        documentNumber: err.documentNumber,
      });

      // 2. Merge ERR+Release PDF with receipt voucher
      const merged = await mergeErrWithReceiptVoucher({
        errReleasePdfPath: latestErrPdf.filePath,
        voucherBytes: savedVoucher.bytes,
        documentNumber: err.documentNumber,
        title: err.title,
        previousGeneratedPath: latestErrPdf.filePath,
      });

      // 3. Database transaction
      await prisma.$transaction(async (tx) => {
        const voucherRecord = await tx.errFile.create({
          data: {
            errId: err.id,
            kind: "RECEIPT_VOUCHER",
            versionNumber: 1,
            revisionNumber: err.revisionNumber,
            filePath: savedVoucher.filePath,
            originalName: savedVoucher.originalName,
            mimeType: savedVoucher.mimeType,
            fileSize: savedVoucher.fileSize,
            uploadedById: access.userId,
          },
        });

        const nextVersion = latestErrPdf.versionNumber + 1;
        const updatedErrPdf = await tx.errFile.update({
          where: { id: latestErrPdf.id },
          data: {
            versionNumber: nextVersion,
            filePath: merged.relativePath,
            originalName: merged.originalName,
            mimeType: "application/pdf",
            fileSize: merged.fileSize,
            uploadedById: access.userId,
          },
        });

        await tx.errApprovalHistory.create({
          data: {
            errId: err.id,
            performedById: access.userId,
            action: "RECEIPT_VOUCHER_ADDED",
            comments: comments || "Receipt voucher added and merged into ERR+Release+Receipt package.",
            revisionNumber: err.revisionNumber,
            inputFileId: voucherRecord.id,
            outputFileId: updatedErrPdf.id,
          },
        });
      });

      return NextResponse.json({
        success: true,
        message: "Receipt voucher uploaded and merged successfully into ERR+Release+Receipt.",
      });
    }
  } catch (error) {
    if (error instanceof PdfValidationError) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 },
      );
    }

    console.error("Voucher processing error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to process voucher." },
      { status: 500 },
    );
  }
}
