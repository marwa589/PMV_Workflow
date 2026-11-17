import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { resolveStoredFilePath } from "@/lib/files";
import { canViewGrvForInvoice } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const grv = await prisma.goodsReceivingVoucher.findUnique({
    where: { id },
    select: { invoiceId: true, filePath: true, originalName: true, mimeType: true },
  });
  if (!grv) return NextResponse.json({ message: "GRV not found." }, { status: 404 });
  if (!(await canViewGrvForInvoice(session, grv.invoiceId))) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  try {
    const bytes = await readFile(resolveStoredFilePath(grv.filePath));
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": grv.mimeType || "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(grv.originalName)}`,
      },
    });
  } catch {
    return NextResponse.json({ message: "GRV file not found on server." }, { status: 404 });
  }
}
