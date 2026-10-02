import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { validateCsrf } from "@/lib/csrf";
import { canViewPurchaseOrder, isMuneer } from "@/lib/po-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!isMuneer(session)) return NextResponse.json({ message: "Only Muneer can confirm PO receipt." }, { status: 403 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id } = await params;
  if (!(await canViewPurchaseOrder(session, id))) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

  const purchaseOrder = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, receivedAt: true, receivedBy: { select: { name: true, email: true } } },
  });
  if (!purchaseOrder) return NextResponse.json({ message: "Purchase order not found." }, { status: 404 });
  if (purchaseOrder.receivedAt && purchaseOrder.receivedBy) {
    return NextResponse.json({
      receivedAt: purchaseOrder.receivedAt.toISOString(),
      receivedByName: purchaseOrder.receivedBy.name,
      receivedByEmail: purchaseOrder.receivedBy.email,
    });
  }

  const receivedAt = new Date();
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { receivedAt, receivedById: session.userId },
    select: { receivedAt: true, receivedBy: { select: { name: true, email: true } } },
  });

  return NextResponse.json({
    receivedAt: updated.receivedAt?.toISOString(),
    receivedByName: updated.receivedBy?.name,
    receivedByEmail: updated.receivedBy?.email,
  });
}