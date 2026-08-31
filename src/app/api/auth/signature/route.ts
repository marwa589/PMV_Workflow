import { UserRole } from "@prisma/client";
import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteDocumentFiles, resolveStoredFilePath, saveUserSignatureFile, uploadSavedFileToGraph } from "@/lib/files";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export const runtime = "nodejs";

function isApprover(role: UserRole) {
  return role === UserRole.APPROVER_1 || role === UserRole.APPROVER_2 || role === UserRole.APPROVER_3;
}

export async function GET() {
  const session = await getSession();
  if (!session || !isApprover(session.role)) {
    return NextResponse.json({ message: "Only approvers can access signatures." }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { signaturePath: true, signatureMimeType: true, signatureOriginalName: true },
  });

  if (!user?.signaturePath) {
    return NextResponse.json({ message: "No signature saved." }, { status: 404 });
  }

  try {
    const buffer = await readFile(resolveStoredFilePath(user.signaturePath));
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": user.signatureMimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${user.signatureOriginalName || "signature"}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ message: "Saved signature file was not found." }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !isApprover(session.role)) {
    return NextResponse.json({ message: "Only approvers can manage signatures." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("signature");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ message: "A signature image is required." }, { status: 400 });
  }

  const current = await prisma.user.findUnique({ where: { id: session.userId }, select: { signaturePath: true } });
  const saved = await saveUserSignatureFile({ userId: session.userId, userName: session.name, file });
  await prisma.user.update({
    where: { id: session.userId },
    data: {
      signaturePath: saved.relativePath,
      signatureOriginalName: file.name,
      signatureMimeType: file.type || "application/octet-stream",
      signatureFileSize: file.size,
      signatureUpdatedAt: new Date(),
    },
  });

  if (current?.signaturePath) {
    await deleteDocumentFiles({ filePaths: [current.signaturePath] });
  }

  await uploadSavedFileToGraph({
    relativePath: saved.relativePath,
    fileName: path.basename(saved.relativePath),
    folder: "Signatures",
    documentId: null,
    performedById: session.userId,
    context: "SIGNATURE_UPDATED",
  });

  await writeAuditLog({
    performedById: session.userId,
    action: "SIGNATURE_UPDATED",
    details: JSON.stringify({ replaced: Boolean(current?.signaturePath), originalName: file.name }),
  });

  return NextResponse.json({ message: "Signature saved." }, { status: 200 });
}

export async function DELETE() {
  const session = await getSession();
  if (!session || !isApprover(session.role)) {
    return NextResponse.json({ message: "Only approvers can manage signatures." }, { status: 403 });
  }

  const current = await prisma.user.findUnique({ where: { id: session.userId }, select: { signaturePath: true } });
  await prisma.user.update({
    where: { id: session.userId },
    data: {
      signaturePath: null,
      signatureOriginalName: null,
      signatureMimeType: null,
      signatureFileSize: null,
      signatureUpdatedAt: null,
    },
  });

  if (current?.signaturePath) {
    await deleteDocumentFiles({ filePaths: [current.signaturePath] });
  }

  await writeAuditLog({
    performedById: session.userId,
    action: "SIGNATURE_REMOVED",
  });

  return NextResponse.json({ message: "Signature removed." }, { status: 200 });
}
