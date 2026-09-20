import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canViewPurchaseOrder } from "@/lib/po-access";
import { resolveStoredFilePath } from "@/lib/files";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Please sign in." }, { status: 401 });
  }

  const ids = new URL(request.url).searchParams.getAll("ids");
  if (ids.length === 0) {
    return NextResponse.json({ message: "No POs selected." }, { status: 400 });
  }

  const visibleIds: string[] = [];
  for (const id of ids) {
    if (await canViewPurchaseOrder(session, id)) visibleIds.push(id);
  }
  if (visibleIds.length === 0) {
    return NextResponse.json({ message: "No selected POs are accessible." }, { status: 403 });
  }

  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { id: { in: visibleIds } },
    select: { id: true, poNumber: true, originalName: true, filePath: true },
  });

  const orderedPos = visibleIds
    .map((id) => purchaseOrders.find((po) => po.id === id))
    .filter((po): po is NonNullable<typeof po> => Boolean(po));

  const mergedPdf = await PDFDocument.create();

  for (const po of orderedPos) {
    if (!po.filePath) continue;
    if (!po.originalName.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { message: `Bulk PDF download supports PDF files only: ${po.originalName}` },
        { status: 400 },
      );
    }

    const sourcePdf = await PDFDocument.load(await readFile(resolveStoredFilePath(po.filePath)));
    const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }

  if (mergedPdf.getPageCount() === 0) {
    return NextResponse.json({ message: "No PO PDF files found." }, { status: 404 });
  }

  const fileName = `pos-${Date.now()}.pdf`;
  return new NextResponse(new Uint8Array(await mergedPdf.save()), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
