import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getErrAccess, canViewErr, canViewErrQuotation } from "@/lib/err/permissions";
import { saveErrFile } from "@/lib/err/files";
import { projectStorageFolderFromFile } from "@/lib/err-storage";
import { validateCsrf } from "@/lib/csrf";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getErrAccess();
  if (!access) return NextResponse.json({ message: "Please sign in." }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });
  if (!canViewErrQuotation(access) || !(await canViewErr(access, (await params).id))) {
    return NextResponse.json({ message: "You are not authorized to add quotations." }, { status: 403 });
  }

  const { id } = await params;
  const formData = await request.formData();
  const files = formData.getAll("quotations").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) return NextResponse.json({ message: "Select at least one quotation." }, { status: 400 });

  const err = await prisma.err.findUnique({
    where: { id },
    select: { id: true, revisionNumber: true, files: { where: { kind: "ERR_PDF" }, orderBy: { versionNumber: "desc" }, take: 1, select: { filePath: true, storageFolder: true } } },
  });
  if (!err) return NextResponse.json({ message: "ERR not found." }, { status: 404 });

  const accepted = new Set(["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png"]);
  if (files.some((file) => !accepted.has(file.name.toLowerCase().split(".").pop() || "") || file.size > 20 * 1024 * 1024)) {
    return NextResponse.json({ message: "Each quotation must be a supported file up to 20 MB." }, { status: 400 });
  }

  const storageFolder = err.files[0]?.storageFolder || projectStorageFolderFromFile(err.files[0]?.filePath);
  const saved = [];
  try {
    for (const file of files) saved.push(await saveErrFile({ errId: id, kind: "QUOTATION", file, storageName: file.name, storageFolder }));
    const existingCount = await prisma.errFile.count({ where: { errId: id, kind: "QUOTATION" } });
    await prisma.$transaction(saved.map((file, index) => prisma.errFile.create({ data: { errId: id, kind: "QUOTATION", versionNumber: existingCount + index + 1, revisionNumber: err.revisionNumber, filePath: file.filePath, storageFolder: file.storageFolder, originalName: file.originalName, mimeType: file.mimeType, fileSize: file.fileSize, uploadedById: access.userId } })));
    return NextResponse.json({ message: `${files.length} quotation(s) attached.` }, { status: 201 });
  } catch {
    return NextResponse.json({ message: "Unable to attach quotations." }, { status: 500 });
  }
}