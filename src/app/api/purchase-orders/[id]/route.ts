import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { validateCsrf } from "@/lib/csrf";
import { deleteDocumentFiles } from "@/lib/files";
import { isOmar } from "@/lib/po-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!validateCsrf(request)) {
    return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });
  }

  const purchaseOrder = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, filePath: true, uploadedById: true },
  });

  if (!purchaseOrder) {
    return NextResponse.json({ message: "Purchase order not found." }, { status: 404 });
  }

  const canDelete = session.role === "ADMIN" || isOmar(session) || purchaseOrder.uploadedById === session.userId;
  if (!canDelete) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderMrLink.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrder.delete({ where: { id } });
    });

    await deleteDocumentFiles({ filePaths: [purchaseOrder.filePath] });
    return NextResponse.json({ message: "Purchase order deleted." }, { status: 200 });
  } catch (error) {
    console.error("PO delete failed.", error);
    return NextResponse.json({ message: "Unable to delete purchase order." }, { status: 500 });
  }
}
