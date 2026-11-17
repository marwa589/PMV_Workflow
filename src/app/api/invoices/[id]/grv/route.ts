import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { validateCsrf } from "@/lib/csrf";
import { deleteDocumentFiles, ensureAllowedFile, saveReceivingVoucherFile } from "@/lib/files";
import { canUploadGrvForInvoice } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Upload the Goods Receiving Voucher of an invoice. Each invoice has at most one GRV. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id: invoiceId } = await params;
  if (!(await canUploadGrvForInvoice(session, invoiceId))) {
    return NextResponse.json({ message: "You cannot upload a GRV for this invoice." }, { status: 403 });
  }

  const invoice = await prisma.purchaseOrderInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, filePath: true, goodsReceivingVoucher: { select: { id: true } } },
  });
  if (!invoice) return NextResponse.json({ message: "Invoice not found." }, { status: 404 });
  if (invoice.goodsReceivingVoucher) {
    return NextResponse.json({ message: "This invoice already has a GRV." }, { status: 409 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) return NextResponse.json({ message: "Select the GRV file." }, { status: 400 });
  if (files.length > 1) return NextResponse.json({ message: "Only one GRV file can be linked to an invoice." }, { status: 400 });

  const [file] = files;
  const validation = ensureAllowedFile(file);
  if (!validation.ok) return NextResponse.json({ message: validation.message || "Unsupported GRV file." }, { status: 400 });

  let savedPath: string | null = null;
  try {
    const saved = await saveReceivingVoucherFile(file, invoice.filePath, "GRV");
    savedPath = saved.relativePath;
    const grv = await prisma.goodsReceivingVoucher.create({
      data: {
        invoiceId,
        originalName: file.name,
        filePath: saved.relativePath,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        uploadedById: session.userId,
      },
      select: { id: true, originalName: true, uploadedAt: true },
    });

    return NextResponse.json({ message: "GRV uploaded.", grv }, { status: 201 });
  } catch (error) {
    if (savedPath) await deleteDocumentFiles({ filePaths: [savedPath] });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ message: "This invoice already has a GRV." }, { status: 409 });
    }
    console.error("GRV upload failed.", error);
    return NextResponse.json({ message: "Unable to upload the GRV file." }, { status: 500 });
  }
}
