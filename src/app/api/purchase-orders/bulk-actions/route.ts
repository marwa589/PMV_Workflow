import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { validateCsrf } from "@/lib/csrf";
import { deleteDocumentFiles } from "@/lib/files";
import { isOmar, canViewPurchaseOrder } from "@/lib/po-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Please sign in." }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const body = await request.json().catch(() => null) as { action?: string; ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];

  if (ids.length === 0) return NextResponse.json({ message: "Select at least one purchase order." }, { status: 400 });

  const accessibleIds: string[] = [];
  for (const id of ids) {
    if (await canViewPurchaseOrder(session, id)) accessibleIds.push(id);
  }

  if (accessibleIds.length === 0) return NextResponse.json({ message: "No selected POs are accessible." }, { status: 403 });

  if (body?.action === "delete") {
    if (session.role !== UserRole.ADMIN) {
      return NextResponse.json({ message: "Only admins can permanently delete purchase orders." }, { status: 403 });
    }

    const rows = await prisma.purchaseOrder.findMany({
      where: { id: { in: accessibleIds } },
      select: { id: true, filePath: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderMrLink.deleteMany({ where: { purchaseOrderId: { in: accessibleIds } } });
      await tx.purchaseOrder.deleteMany({ where: { id: { in: accessibleIds } } });
    });

    await deleteDocumentFiles({ filePaths: rows.map((row) => row.filePath) });
    return NextResponse.json({ message: `${accessibleIds.length} PO(s) deleted.` });
  }

  if (body?.action === "request-delete") {
    const allowed = session.role === UserRole.ADMIN || isOmar(session);
    if (!allowed) {
      return NextResponse.json({ message: "Only admins or the uploader can request deletion of purchase orders." }, { status: 403 });
    }

    const adminIds = await prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });

    if (adminIds.length === 0) {
      return NextResponse.json({ message: "No admin recipients are available." }, { status: 400 });
    }

    await prisma.notification.createMany({
      data: adminIds.map((admin) => ({
        userId: admin.id,
        type: "PENDING_APPROVAL",
        title: "Purchase order deletion requested",
        message: `${accessibleIds.length} PO(s) were requested for deletion by ${session.name}.`,
      })),
    });

    return NextResponse.json({ message: `${accessibleIds.length} deletion request(s) sent to Admin.` });
  }

  return NextResponse.json({ message: "Unsupported bulk action." }, { status: 400 });
}
