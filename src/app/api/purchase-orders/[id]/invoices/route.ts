import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { validateCsrf } from "@/lib/csrf";
import { deleteDocumentFiles, ensureAllowedFile, savePurchaseOrderInvoiceFile } from "@/lib/files";
import { canUploadInvoicesForPurchaseOrder, canViewInvoicesForPurchaseOrder } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id: purchaseOrderId } = await params;
  if (!(await canViewInvoicesForPurchaseOrder(session, purchaseOrderId))) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const invoices = await prisma.purchaseOrderInvoice.findMany({
    where: { purchaseOrderId },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
      uploadedAt: true,
      uploadedBy: { select: { name: true } },
    },
  });

  return NextResponse.json({ invoices });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id: purchaseOrderId } = await params;
  if (!(await canUploadInvoicesForPurchaseOrder(session, purchaseOrderId))) {
    return NextResponse.json({ message: "You cannot upload invoices for this purchase order." }, { status: 403 });
  }

  const purchaseOrder = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, filePath: true },
  });
  if (!purchaseOrder) return NextResponse.json({ message: "Purchase order not found." }, { status: 404 });

  const formData = await request.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) return NextResponse.json({ message: "Select at least one invoice file." }, { status: 400 });

  for (const file of files) {
    const validation = ensureAllowedFile(file);
    if (!validation.ok) return NextResponse.json({ message: validation.message || "Unsupported invoice file." }, { status: 400 });
  }

  const savedPaths: string[] = [];
  try {
    const invoices = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const file of files) {
        const saved = await savePurchaseOrderInvoiceFile(file, purchaseOrder.filePath);
        savedPaths.push(saved.relativePath);
        created.push(await tx.purchaseOrderInvoice.create({
          data: {
            purchaseOrderId,
            originalName: file.name,
            filePath: saved.relativePath,
            mimeType: file.type || "application/octet-stream",
            fileSize: file.size,
            uploadedById: session.userId,
          },
          select: { id: true, originalName: true, uploadedAt: true },
        }));
      }
      return created;
    });

    return NextResponse.json({ message: `${invoices.length} invoice(s) uploaded.`, invoices }, { status: 201 });
  } catch (error) {
    if (savedPaths.length > 0) {
      await deleteDocumentFiles({ filePaths: savedPaths });
    }
    console.error("PO invoice upload failed.", error);
    return NextResponse.json({ message: "Unable to upload invoice files." }, { status: 500 });
  }
}