import { DocumentStatus, MrType, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { validateCsrf } from "@/lib/csrf";
import { deleteDocumentFiles, ensureAllowedFile, saveReceivingVoucherFile } from "@/lib/files";
import { canUploadCashReceivingVoucherForMr } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Upload the Cash Receiving Voucher of an approved Cash MR. Each Cash MR has at most one. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id: documentId } = await params;
  if (!(await canUploadCashReceivingVoucherForMr(session, documentId))) {
    return NextResponse.json({ message: "You cannot upload a Cash Receiving Voucher for this Cash MR." }, { status: 403 });
  }

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      documentType: "MATERIAL_REQUISITION",
      mrType: MrType.CASH,
      status: DocumentStatus.APPROVED,
    },
    select: { currentVersion: true, cashReceivingVoucher: { select: { id: true } } },
  });
  if (!document) return NextResponse.json({ message: "The selected item is not an approved Cash MR." }, { status: 400 });
  if (document.cashReceivingVoucher) {
    return NextResponse.json({ message: "This Cash MR already has a Cash Receiving Voucher." }, { status: 409 });
  }

  const currentVersion = await prisma.documentVersion.findUnique({
    where: { documentId_versionNumber: { documentId, versionNumber: document.currentVersion } },
    select: { filePath: true },
  });
  if (!currentVersion) return NextResponse.json({ message: "Cash MR file not found." }, { status: 404 });

  const formData = await request.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) return NextResponse.json({ message: "Select the Cash Receiving Voucher file." }, { status: 400 });
  if (files.length > 1) return NextResponse.json({ message: "Only one Cash Receiving Voucher file can be linked to a Cash MR." }, { status: 400 });

  const [file] = files;
  const validation = ensureAllowedFile(file);
  if (!validation.ok) return NextResponse.json({ message: validation.message || "Unsupported voucher file." }, { status: 400 });

  let savedPath: string | null = null;
  try {
    const saved = await saveReceivingVoucherFile(file, currentVersion.filePath, "CASH_RECEIVING_VOUCHER");
    savedPath = saved.relativePath;
    const voucher = await prisma.cashReceivingVoucher.create({
      data: {
        documentId,
        originalName: file.name,
        filePath: saved.relativePath,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        uploadedById: session.userId,
      },
      select: { id: true, originalName: true, uploadedAt: true },
    });

    return NextResponse.json({ message: "Cash Receiving Voucher uploaded.", voucher }, { status: 201 });
  } catch (error) {
    if (savedPath) await deleteDocumentFiles({ filePaths: [savedPath] });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ message: "This Cash MR already has a Cash Receiving Voucher." }, { status: 409 });
    }
    console.error("Cash Receiving Voucher upload failed.", error);
    return NextResponse.json({ message: "Unable to upload the Cash Receiving Voucher file." }, { status: 500 });
  }
}
