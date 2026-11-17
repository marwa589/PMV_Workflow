import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { validateCsrf } from "@/lib/csrf";
import { deleteDocumentFiles } from "@/lib/files";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (session.role !== UserRole.ADMIN) return NextResponse.json({ message: "Only admins can delete Cash Receiving Vouchers." }, { status: 403 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });

  const { id } = await params;
  const voucher = await prisma.cashReceivingVoucher.findUnique({ where: { id }, select: { id: true, filePath: true } });
  if (!voucher) return NextResponse.json({ message: "Cash Receiving Voucher not found." }, { status: 404 });

  await prisma.cashReceivingVoucher.delete({ where: { id } });
  try {
    await deleteDocumentFiles({ filePaths: [voucher.filePath] });
  } catch (error) {
    console.error("Cash Receiving Voucher record deleted but its stored file could not be removed.", error);
  }

  return NextResponse.json({ message: "Cash Receiving Voucher deleted." });
}
