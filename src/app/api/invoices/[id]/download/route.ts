import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { resolveStoredFilePath } from "@/lib/files";
import { canViewInvoicesForMr, canViewInvoicesForPurchaseOrder } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const invoice = await prisma.purchaseOrderInvoice.findUnique({
    where: { id },
    select: { purchaseOrderId: true, documentId: true, filePath: true, originalName: true, mimeType: true },
  });
  if (!invoice) return NextResponse.json({ message: "Invoice not found." }, { status: 404 });
  const canView = invoice.purchaseOrderId
    ? await canViewInvoicesForPurchaseOrder(session, invoice.purchaseOrderId)
    : invoice.documentId
      ? await canViewInvoicesForMr(session, invoice.documentId)
      : false;
  if (!canView) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  try {
    const bytes = await readFile(resolveStoredFilePath(invoice.filePath));
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": invoice.mimeType || "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(invoice.originalName)}`,
      },
    });
  } catch {
    return NextResponse.json({ message: "Invoice file not found on server." }, { status: 404 });
  }
}