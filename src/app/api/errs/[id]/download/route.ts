import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { ErrFileKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveStoredFilePath } from "@/lib/files";
import { canViewErr, getErrAccess } from "@/lib/err/permissions";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await getErrAccess();

  if (!access) {
    return NextResponse.json(
      { message: "Please sign in." },
      { status: 401 },
    );
  }

  const { id } = await params;

  if (!(await canViewErr(access, id))) {
    return NextResponse.json(
      { message: "You do not have access to this ERR." },
      { status: 403 },
    );
  }

  const kindParam = new URL(_request.url).searchParams.get("kind");
  const fileId = new URL(_request.url).searchParams.get("fileId");

  const validKinds: ErrFileKind[] = [
    ErrFileKind.ERR_PDF,
    ErrFileKind.QUOTATION,
    ErrFileKind.ATTACHMENT,
    ErrFileKind.RELEASE_VOUCHER,
    ErrFileKind.RECEIPT_VOUCHER,
  ];

  const matchedKind = validKinds.find((k) => k === kindParam);

  if (!fileId && !matchedKind) {
    return NextResponse.json(
      { message: "Select a valid ERR attachment." },
      { status: 400 },
    );
  }

  const file = await prisma.errFile.findFirst({
    where: {
      errId: id,
      ...(fileId ? { id: fileId } : matchedKind ? { kind: matchedKind } : {}),
    },
    select: {
      id: true,
      kind: true,
      filePath: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
    },
    ...(fileId ? {} : { orderBy: { versionNumber: "desc" as const } }),
  });

  if (!file) {
    return NextResponse.json(
      { message: "The requested file was not found." },
      { status: 404 },
    );
  }

  if (
    (file.kind === "QUOTATION" || file.kind === "ATTACHMENT") &&
    !access.isUploader &&
    !access.isAdmin &&
    !access.isPmvManager
  ) {
    return NextResponse.json(
      { message: "You do not have access to this quotation." },
      { status: 403 },
    );
  }

  try {
    const buffer = await readFile(resolveStoredFilePath(file.filePath));

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": file.mimeType || "application/pdf",
        "Content-Disposition": `inline; filename="${file.originalName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { message: "The requested file could not be loaded." },
      { status: 404 },
    );
  }
}
