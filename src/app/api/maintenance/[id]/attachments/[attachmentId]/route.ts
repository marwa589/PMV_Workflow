import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveStoredFilePath } from "@/lib/files";
import { canViewMaintenanceTicket, loadMaintenanceActor } from "@/lib/maintenance/access";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const actor = await loadMaintenanceActor(session);
  if (!actor) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const { id, attachmentId } = await params;
  const [ticket, attachment] = await Promise.all([
    prisma.maintenanceTicket.findUnique({ where: { id }, include: { project: { select: { locationId: true, companyId: true } }, steps: { include: { approvers: true } } } }),
    prisma.maintenanceTicketAttachment.findFirst({ where: { id: attachmentId, ticketId: id } }),
  ]);
  if (!ticket || !attachment) return NextResponse.json({ message: "Attachment not found." }, { status: 404 });
  if (!canViewMaintenanceTicket(actor, ticket)) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  try {
    const bytes = await readFile(resolveStoredFilePath(attachment.filePath));
    const safeName = attachment.originalName.replace(/[\r\n"\\]/g, "_");
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": attachment.mimeType, "Content-Length": String(bytes.byteLength), "Content-Disposition": `attachment; filename="${safeName}"`, "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ message: "Attachment file is missing from storage." }, { status: 404 });
  }
}
