import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveStoredFilePath } from "@/lib/files";
import { canViewPurchaseOrder } from "@/lib/po-access";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await canViewPurchaseOrder(session, id))) return NextResponse.json({ message: "Forbidden" }, { status: 403 });

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { filePath: true, originalName: true, mimeType: true },
  });
  if (!po) return NextResponse.json({ message: "PO not found." }, { status: 404 });

  try {
    const buffer = await readFile(resolveStoredFilePath(po.filePath));
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": po.mimeType || "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${po.originalName}"`,
      },
    });
  } catch {
    return NextResponse.json({ message: "PO file not found on server." }, { status: 404 });
  }
}
