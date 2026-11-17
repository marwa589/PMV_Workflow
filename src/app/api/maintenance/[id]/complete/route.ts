import { MaintenanceTicketStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { validateCsrf } from "@/lib/csrf";
import { deleteDocumentFiles, ensureAllowedFile, saveStoredFile } from "@/lib/files";
import { canActOnMaintenanceTicket, emailMaintenanceLevel, loadMaintenanceActor } from "@/lib/maintenance/access";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });
  const actor = await loadMaintenanceActor(session);
  if (!actor) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const form = await request.formData();
  const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > 10) return NextResponse.json({ message: "You can attach up to 10 files." }, { status: 400 });
  if (files.reduce((total, file) => total + file.size, 0) > 80 * 1024 * 1024) return NextResponse.json({ message: "The combined attachment size must be 80 MB or smaller." }, { status: 400 });
  for (const file of files) {
    const valid = ensureAllowedFile(file);
    if (!valid.ok) return NextResponse.json({ message: valid.message }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ message: "Each attachment must be 20 MB or smaller." }, { status: 400 });
  }

  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id },
    include: {
      project: { select: { locationId: true, companyId: true } },
      steps: { orderBy: { levelNumber: "asc" }, include: { approvers: true } },
    },
  });
  if (!ticket) return NextResponse.json({ message: "Maintenance ticket not found." }, { status: 404 });
  if (ticket.status === MaintenanceTicketStatus.CLOSED) return NextResponse.json({ message: "This ticket is already closed." }, { status: 409 });
  if (!canActOnMaintenanceTicket(actor, ticket)) return NextResponse.json({ message: "You are not assigned to the current level of this ticket." }, { status: 403 });

  const currentStep = ticket.steps.find((step) => step.levelNumber === ticket.currentLevel);
  if (!currentStep || currentStep.status !== "PENDING") return NextResponse.json({ message: "The current workflow level is not available." }, { status: 409 });
  const nextStep = ticket.steps.find((step) => step.levelNumber === ticket.currentLevel + 1);
  const now = new Date();
  const savedFiles: Array<{ relativePath: string; originalName: string; mimeType: string; fileSize: number }> = [];
  try {
    for (const file of files) {
      const valid = ensureAllowedFile(file);
      const saved = await saveStoredFile({ relativePath: `maintenance/${id}/${randomUUID()}.${valid.extension ?? "file"}`, bytes: new Uint8Array(await file.arrayBuffer()) });
      savedFiles.push({ relativePath: saved.relativePath, originalName: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size });
    }
    await prisma.$transaction(async (tx) => {
      const completed = await tx.maintenanceTicketLevel.updateMany({ where: { id: currentStep.id, status: "PENDING" }, data: { status: "COMPLETED", actedById: session.userId, actedAt: now } });
      if (completed.count !== 1) throw new Error("LEVEL_ALREADY_COMPLETED");
      const moved = await tx.maintenanceTicket.updateMany({ where: { id, currentLevel: ticket.currentLevel, status: { not: MaintenanceTicketStatus.CLOSED } }, data: nextStep ? { currentLevel: nextStep.levelNumber, status: MaintenanceTicketStatus.IN_PROGRESS } : { status: MaintenanceTicketStatus.CLOSED, closedAt: now } });
      if (moved.count !== 1) throw new Error("TICKET_ALREADY_MOVED");
      if (nextStep) {
        await tx.maintenanceTicketEvent.create({ data: { ticketId: id, actorId: session.userId, levelNumber: currentStep.levelNumber, action: "LEVEL_COMPLETED", details: `Level ${currentStep.levelNumber} completed; moved to level ${nextStep.levelNumber}.` } });
      } else {
        await tx.maintenanceTicketEvent.create({ data: { ticketId: id, actorId: session.userId, levelNumber: currentStep.levelNumber, action: "CLOSED", details: "Final maintenance workflow level completed; ticket closed." } });
      }
      if (savedFiles.length) await tx.maintenanceTicketAttachment.createMany({ data: savedFiles.map((file) => ({ ticketId: id, uploadedById: session.userId, filePath: file.relativePath, originalName: file.originalName, mimeType: file.mimeType, fileSize: file.fileSize })) });
    });
    if (nextStep) { try { await emailMaintenanceLevel(id, nextStep.levelNumber); } catch (emailError) { console.error("[MAINTENANCE EMAIL]", emailError); } }
    return NextResponse.json({ message: nextStep ? `Level ${currentStep.levelNumber} completed. Ticket moved to level ${nextStep.levelNumber}.` : "Final level completed. Ticket closed." });
  } catch (error) {
    await deleteDocumentFiles({ filePaths: savedFiles.map((file) => file.relativePath) });
    if (error instanceof Error && (error.message === "LEVEL_ALREADY_COMPLETED" || error.message === "TICKET_ALREADY_MOVED")) {
      return NextResponse.json({ message: "Another user has already completed or moved this ticket level. Refresh the page." }, { status: 409 });
    }
    console.error("[MAINTENANCE COMPLETE]", error);
    return NextResponse.json({ message: "Unable to complete the maintenance level." }, { status: 500 });
  }
}
