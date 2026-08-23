import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteDocumentFiles } from "@/lib/files";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  if (ids.length === 0) {
    return NextResponse.json({ message: "No documents selected." }, { status: 400 });
  }

  if (session.role === UserRole.CLERK) {
    return NextResponse.json({ message: "Use the deletion request endpoint." }, { status: 403 });
  }

  if (session.role !== UserRole.ADMIN) {
    return NextResponse.json({ message: "Only Admin can permanently delete documents." }, { status: 403 });
  }

  const documents = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      mrNumber: true,
      documentType: true,
      versions: { select: { filePath: true } },
      linkedMRs: { select: { mrNumber: true } },
    },
  });

  await prisma.$transaction(async (tx) => {
    const documentIds = documents.map((document) => document.id);
    await tx.approvalHistory.deleteMany({ where: { documentId: { in: documentIds } } });
    await tx.emailNotificationEvent.deleteMany({ where: { documentId: { in: documentIds } } });
    await tx.notification.deleteMany({ where: { documentId: { in: documentIds } } });
    await tx.document.deleteMany({ where: { id: { in: documents.map((document) => document.id) } } });
  });

  const directoryPaths = documents.flatMap((document) => [
    ...(document.mrNumber && document.documentType === "MATERIAL_REQUISITION" ? [`MRs+Comparisons/MR-${document.mrNumber}`] : []),
    ...document.linkedMRs
      .filter((mr) => Boolean(mr.mrNumber))
      .map((mr) => `MRs+Comparisons/MR-${mr.mrNumber}`),
  ]);
  await deleteDocumentFiles({
    filePaths: documents.flatMap((document) => document.versions.map((version) => version.filePath)),
    directoryPaths,
  });

  return NextResponse.json({ message: `${documents.length} document(s) permanently deleted.` }, { status: 200 });
}
