import { randomUUID } from "node:crypto";
import { MaintenanceRequestType, MaintenanceTicketStatus, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { validateCsrf } from "@/lib/csrf";
import { deleteDocumentFiles, ensureAllowedFile, saveStoredFile } from "@/lib/files";
import {
  SUBMIT_LEVEL,
  actorMatchesEntries,
  canActOnMaintenanceTicket,
  canViewMaintenanceTicket,
  emailMaintenanceLevel,
  getSubmitOptions,
  loadMaintenanceActor,
  maintenanceTicketInclude,
  nextTicketNumber,
  serializeMaintenanceTicket,
  workflowProblem,
  workflowWithLevels,
} from "@/lib/maintenance/access";

export const runtime = "nodejs";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const PHONE_PATTERN = /^\+?[0-9][0-9\s().-]{3,24}$/;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const actor = await loadMaintenanceActor(session);
  if (!actor) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const options = await getSubmitOptions(actor);

  // Narrow in the database to tickets this person could possibly see, then apply the exact rules in memory.
  const where: Prisma.MaintenanceTicketWhereInput = actor.isAdmin
    ? {}
    : {
        OR: [
          { requesterId: actor.userId },
          { steps: { some: { approvers: { some: { OR: [{ userId: actor.userId }, { userTypeId: actor.userTypeId }] } } } } },
        ],
      };
  const rawTickets = await prisma.maintenanceTicket.findMany({ where, include: maintenanceTicketInclude, orderBy: { createdAt: "desc" }, take: 500 });

  const tickets = rawTickets
    .filter((ticket) => canViewMaintenanceTicket(actor, ticket))
    .map((ticket) => ({
      ...serializeMaintenanceTicket(ticket),
      canAct: canActOnMaintenanceTicket(actor, ticket),
      isRequester: ticket.requesterId === actor.userId,
    }));

  return NextResponse.json({
    projects: options.projects,
    items: options.items,
    pairs: options.pairs,
    tickets,
    canSubmit: options.pairs.length > 0,
    isAdmin: actor.isAdmin,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 });
  const actor = await loadMaintenanceActor(session);
  if (!actor) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const projectId = String(form.get("projectId") ?? "").trim();
  const itemId = String(form.get("itemId") ?? "").trim();
  const requestTypeRaw = String(form.get("requestType") ?? "").trim();
  const unitsRaw = String(form.get("units") ?? "").trim();
  const units = /^\d+$/.test(unitsRaw) ? Number(unitsRaw) : NaN;
  const phoneNumber = String(form.get("phoneNumber") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();

  if (!projectId || !itemId || !description) return NextResponse.json({ message: "Project, item and description are required." }, { status: 400 });
  if (!Number.isSafeInteger(units) || units < 1 || units > 100000) return NextResponse.json({ message: "Number of units must be a whole number of at least 1." }, { status: 400 });
  if (requestTypeRaw !== "REPAIR" && requestTypeRaw !== "NEW_INSTALLATION") return NextResponse.json({ message: "Select repair or new installation." }, { status: 400 });
  if (!PHONE_PATTERN.test(phoneNumber)) return NextResponse.json({ message: "Enter a valid contact phone number." }, { status: 400 });

  const assignment = await prisma.maintenanceWorkflowAssignment.findUnique({
    where: { projectId_itemId: { projectId, itemId } },
    include: {
      project: { select: { id: true, isActive: true, locationId: true } },
      item: { select: { id: true, isActive: true } },
      workflow: { include: workflowWithLevels },
    },
  });
  if (!assignment || !assignment.project.isActive || !assignment.item.isActive) {
    return NextResponse.json({ message: "This item is not set up for maintenance requests on the selected project." }, { status: 409 });
  }
  const problem = workflowProblem(assignment.workflow);
  if (problem) return NextResponse.json({ message: `${problem} Please contact an administrator.` }, { status: 409 });

  const workflow = assignment.workflow;
  const submitters = workflow.levels.find((level) => level.levelNumber === SUBMIT_LEVEL)?.approvers ?? [];
  if (!actorMatchesEntries(actor, submitters, { projectId, locationId: assignment.project.locationId })) {
    return NextResponse.json({ message: "You are not allowed to submit maintenance requests for this project and item." }, { status: 403 });
  }
  const followUpLevels = workflow.levels.filter((level) => level.levelNumber > SUBMIT_LEVEL);

  const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > MAX_FILES) return NextResponse.json({ message: `You can attach up to ${MAX_FILES} files.` }, { status: 400 });
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) return NextResponse.json({ message: "The combined attachment size must be 80 MB or smaller." }, { status: 400 });
  const extensions: string[] = [];
  for (const file of files) {
    const valid = ensureAllowedFile(file);
    if (!valid.ok) return NextResponse.json({ message: valid.message }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ message: "Each attachment must be 20 MB or smaller." }, { status: 400 });
    extensions.push(valid.extension ?? "file");
  }

  const id = randomUUID();
  const savedFiles: Array<{ relativePath: string; originalName: string; mimeType: string; fileSize: number }> = [];
  try {
    for (const [index, file] of files.entries()) {
      const saved = await saveStoredFile({ relativePath: `maintenance/${id}/${randomUUID()}.${extensions[index]}`, bytes: new Uint8Array(await file.arrayBuffer()) });
      savedFiles.push({ relativePath: saved.relativePath, originalName: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size });
    }

    let ticket: { id: string; ticketNumber: string } | null = null;
    for (let attempt = 0; attempt < 5 && !ticket; attempt += 1) {
      try {
        ticket = await prisma.maintenanceTicket.create({
          data: {
            id,
            ticketNumber: await nextTicketNumber(),
            projectId,
            itemId,
            requesterId: actor.userId,
            workflowId: workflow.id,
            requestType: requestTypeRaw === "REPAIR" ? MaintenanceRequestType.REPAIR : MaintenanceRequestType.NEW_INSTALLATION,
            units,
            phoneNumber,
            description,
            status: MaintenanceTicketStatus.OPEN,
            currentLevel: 1,
            // The levels and assignees are copied onto the ticket, so later workflow edits never change tickets already in progress.
            steps: { create: followUpLevels.map((level) => ({ levelNumber: level.levelNumber, name: level.name, approvers: { create: level.approvers.map((a) => ({ approverType: a.approverType, userId: a.userId, userTypeId: a.userTypeId })) } })) },
            events: { create: { actorId: actor.userId, levelNumber: SUBMIT_LEVEL, action: "SUBMITTED", details: "Maintenance ticket submitted." } },
            attachments: { create: savedFiles.map((file) => ({ uploadedById: actor.userId, filePath: file.relativePath, originalName: file.originalName, mimeType: file.mimeType, fileSize: file.fileSize })) },
          },
          select: { id: true, ticketNumber: true },
        });
      } catch (error) {
        // Two people submitting at the same moment can pick the same number; try the next one.
        const clash = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && String(error.meta?.target ?? "").includes("ticketNumber");
        if (!clash) throw error;
      }
    }
    if (!ticket) throw new Error("Could not allocate a ticket number.");

    try { await emailMaintenanceLevel(ticket.id, 1); } catch (emailError) { console.error("[MAINTENANCE EMAIL]", emailError); }
    return NextResponse.json({ ticket, message: "Maintenance ticket submitted." }, { status: 201 });
  } catch (error) {
    await deleteDocumentFiles({ filePaths: savedFiles.map((file) => file.relativePath) });
    console.error("[MAINTENANCE SUBMIT]", error);
    return NextResponse.json({ message: "Unable to submit the maintenance ticket." }, { status: 500 });
  }
}
