import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { resolveStoredFilePath } from "@/lib/files";
import { canViewCashReceivingVoucherForMr } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const voucher = await prisma.cashReceivingVoucher.findUnique({
    where: { id },
    select: { documentId: true, filePath: true, originalName: true, mimeType: true },
  });
  if (!voucher) return NextResponse.json({ message: "Cash Receiving Voucher not found." }, { status: 404 });
  if (!(await canViewCashReceivingVoucherForMr(session, voucher.documentId))) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  try {
    const bytes = await readFile(resolveStoredFilePath(voucher.filePath));
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": voucher.mimeType || "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(voucher.originalName)}`,
      },
    });
  } catch {
    return NextResponse.json({ message: "Cash Receiving Voucher file not found on server." }, { status: 404 });
  }
}
