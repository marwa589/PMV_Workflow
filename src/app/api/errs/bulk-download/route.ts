import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getErrAccess, canViewErr } from "@/lib/err/permissions";
import { prisma } from "@/lib/prisma";
import { resolveStoredFilePath } from "@/lib/files";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await getErrAccess();
  if (!access) {
    return NextResponse.json({ message: "Please sign in." }, { status: 401 });
  }

  const ids = new URL(request.url).searchParams.getAll("ids");
  if (ids.length === 0) {
    return NextResponse.json({ message: "No ERRs selected." }, { status: 400 });
  }

  const visibleIds: string[] = [];
  for (const id of ids) {
    if (await canViewErr(access, id)) visibleIds.push(id);
  }
  if (visibleIds.length === 0) {
    return NextResponse.json({ message: "No selected ERRs are accessible." }, { status: 403 });
  }

  const errs = await prisma.err.findMany({
    where: { id: { in: visibleIds } },
    select: {
      id: true,
      documentNumber: true,
      files: {
        where: { kind: "ERR_PDF" },
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { filePath: true, originalName: true },
      },
    },
  });

  const orderedErrs = visibleIds
    .map((id) => errs.find((err) => err.id === id))
    .filter((err): err is NonNullable<typeof err> => Boolean(err));

  const mergedPdf = await PDFDocument.create();
  for (const err of orderedErrs) {
    const file = err.files[0];
    if (!file) continue;
    if (!file.originalName.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { message: `Bulk PDF download supports PDF files only: ${file.originalName}` },
        { status: 400 },
      );
    }

    const sourcePdf = await PDFDocument.load(await readFile(resolveStoredFilePath(file.filePath)));
    const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }

  if (mergedPdf.getPageCount() === 0) {
    return NextResponse.json({ message: "No primary ERR PDF files found." }, { status: 404 });
  }

  const fileName = `errs-${Date.now()}.pdf`;
  return new NextResponse(new Uint8Array(await mergedPdf.save()), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
