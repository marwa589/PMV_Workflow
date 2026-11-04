import "server-only";
import { ApproverType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ASSIGNMENT_SCOPE_SELECT, type AssignmentScope } from "@/lib/auth/access";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";

/**
 * Maintenance follows the same convention as document approval flows:
 *   - Level 0 of a maintenance workflow = the people who may SUBMIT a ticket.
 *   - Levels 1..N = the people who follow the ticket up, one level after the other.
 *   - A flow entry that names a USER works for that user.
 *   - A flow entry that names a USER TYPE works for users of that type who also hold an assignment that
 *     covers the ticket's project (or its location). Admin users can always act.
 * No separate maintenance permission is needed except `maintenance.manage` for the setup screens.
 */

export const SUBMIT_LEVEL = 0;

export type MaintenanceEntry = { approverType: ApproverType; userId: string | null; userTypeId: string | null };
export type MaintenanceProjectCtx = { projectId: string; locationId: string | null };

export type MaintenanceSession = { userId: string; userType: UserTypeCode; email?: string; name?: string };

export type MaintenanceActor = {
  userId: string;
  userType: UserTypeCode;
  userTypeId: string;
  isAdmin: boolean;
  assignments: AssignmentScope[];
};

export async function loadMaintenanceActor(session: MaintenanceSession): Promise<MaintenanceActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, isActive: true, userTypeId: true, userType: { select: { code: true } }, assignments: { select: ASSIGNMENT_SCOPE_SELECT } },
  });
  if (!user || !user.isActive) return null;
  const userType = user.userType.code as UserTypeCode;
  return { userId: user.id, userType, userTypeId: user.userTypeId, isAdmin: userType === USER_TYPE.ADMIN, assignments: user.assignments };
}

/** An assignment covers a project when its project / location columns allow it. Document-type scoping is irrelevant here. */
export function assignmentCoversProject(assignment: AssignmentScope, ctx: MaintenanceProjectCtx): boolean {
  if (assignment.companyId) return false;
  if (assignment.locationId && assignment.locationId !== ctx.locationId) return false;
  const projectIds = [
    ...(assignment.projectId ? [assignment.projectId] : []),
    ...(assignment.projectScopes ?? []).map((scope) => scope.projectId),
  ];
  return projectIds.length === 0 || projectIds.includes(ctx.projectId);
}

export function actorMatchesEntries(actor: MaintenanceActor, entries: MaintenanceEntry[], ctx: MaintenanceProjectCtx): boolean {
  if (actor.isAdmin) return true;
  return entries.some((entry) => {
    if (entry.approverType === ApproverType.USER) return entry.userId === actor.userId;
    return entry.userTypeId === actor.userTypeId && actor.assignments.some((assignment) => assignmentCoversProject(assignment, ctx));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Workflow shape
// ---------------------------------------------------------------------------------------------------------------------

export type WorkflowForCheck = {
  isActive: boolean;
  levels: Array<{ levelNumber: number; name: string; approvers: MaintenanceEntry[] }>;
};

/** Returns null when the workflow can run tickets, otherwise a readable reason. */
export function workflowProblem(workflow: WorkflowForCheck | null | undefined): string | null {
  if (!workflow) return "No workflow is assigned.";
  if (!workflow.isActive) return "The assigned workflow is inactive.";
  const levels = [...workflow.levels].sort((a, b) => a.levelNumber - b.levelNumber);
  const submitters = levels.find((level) => level.levelNumber === SUBMIT_LEVEL);
  if (!submitters || submitters.approvers.length === 0) return "The workflow has no submitters (level 0).";
  const followUp = levels.filter((level) => level.levelNumber > SUBMIT_LEVEL);
  if (followUp.length === 0) return "The workflow has no follow-up levels.";
  if (followUp.some((level, index) => level.levelNumber !== index + 1 || level.approvers.length === 0)) return "The workflow has a follow-up level without assignees.";
  return null;
}

export const workflowWithLevels = {
  levels: { orderBy: { levelNumber: "asc" as const }, include: { approvers: true } },
} satisfies Prisma.MaintenanceWorkflowInclude;

// ---------------------------------------------------------------------------------------------------------------------
// What may this person submit?
// ---------------------------------------------------------------------------------------------------------------------

export type SubmitOptions = {
  projects: Array<{ id: string; code: string; name: string }>;
  items: Array<{ id: string; name: string }>;
  /** Every project + item combination the person may submit for. The form uses it to filter the item list per project. */
  pairs: Array<{ projectId: string; itemId: string }>;
};

export async function getSubmitOptions(actor: MaintenanceActor): Promise<SubmitOptions> {
  const assignments = await prisma.maintenanceWorkflowAssignment.findMany({
    where: { project: { isActive: true }, item: { isActive: true }, workflow: { isActive: true } },
    include: {
      project: { select: { id: true, code: true, name: true, locationId: true } },
      item: { select: { id: true, name: true } },
      workflow: { include: workflowWithLevels },
    },
  });

  const projects = new Map<string, { id: string; code: string; name: string }>();
  const items = new Map<string, { id: string; name: string }>();
  const pairs: SubmitOptions["pairs"] = [];

  for (const assignment of assignments) {
    if (workflowProblem(assignment.workflow)) continue;
    const submitters = assignment.workflow.levels.find((level) => level.levelNumber === SUBMIT_LEVEL)?.approvers ?? [];
    const ctx = { projectId: assignment.project.id, locationId: assignment.project.locationId };
    if (!actorMatchesEntries(actor, submitters, ctx)) continue;
    projects.set(assignment.project.id, { id: assignment.project.id, code: assignment.project.code, name: assignment.project.name });
    items.set(assignment.item.id, assignment.item);
    pairs.push({ projectId: assignment.project.id, itemId: assignment.item.id });
  }

  return {
    projects: [...projects.values()].sort((a, b) => a.code.localeCompare(b.code)),
    items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)),
    pairs,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------------------------------------------------

type TicketForAccess = {
  requesterId: string;
  projectId: string;
  status: string;
  currentLevel: number;
  project: { locationId: string | null };
  steps: Array<{ levelNumber: number; approvers: MaintenanceEntry[] }>;
};

const ctxOf = (ticket: TicketForAccess): MaintenanceProjectCtx => ({ projectId: ticket.projectId, locationId: ticket.project.locationId });

/** The requester, admins, and everyone named on a level the ticket has reached (current or already passed). */
export function canViewMaintenanceTicket(actor: MaintenanceActor, ticket: TicketForAccess): boolean {
  if (actor.isAdmin || ticket.requesterId === actor.userId) return true;
  const reached = ticket.steps.filter((step) => step.levelNumber <= ticket.currentLevel);
  return reached.some((step) => actorMatchesEntries(actor, step.approvers, ctxOf(ticket)));
}

/** Only people named on the current level (and admins) may complete it. */
export function canActOnMaintenanceTicket(actor: MaintenanceActor, ticket: TicketForAccess): boolean {
  if (ticket.status === "CLOSED") return false;
  const step = ticket.steps.find((candidate) => candidate.levelNumber === ticket.currentLevel);
  if (!step) return false;
  return actorMatchesEntries(actor, step.approvers, ctxOf(ticket));
}

/** Does this person have any reason to see the Maintenance page? Used for the sidebar. */
export async function userHasMaintenanceAccess(session: MaintenanceSession): Promise<boolean> {
  if (session.userType === USER_TYPE.ADMIN) return true;
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { userTypeId: true, _count: { select: { assignments: true } } } });
  if (!user) return false;
  if ((await prisma.maintenanceTicket.count({ where: { requesterId: session.userId } })) > 0) return true;
  const entryMatch = [{ userId: session.userId }, ...(user._count.assignments > 0 ? [{ userTypeId: user.userTypeId }] : [])];
  // Named on a workflow that is in use, or on a ticket that already exists (so people keep access to tickets they handled
  // even after the workflow is edited).
  const [inWorkflow, onTicket] = await Promise.all([
    prisma.maintenanceWorkflowStepApprover.count({ where: { OR: entryMatch, level: { workflow: { isActive: true, assignments: { some: {} } } } } }),
    prisma.maintenanceTicketLevelApprover.count({ where: { OR: entryMatch } }),
  ]);
  return inWorkflow > 0 || onTicket > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------------------------------

/** People who should be told that a ticket reached a level: named users and typed users covering the project. Admins are not emailed. */
export async function emailMaintenanceLevel(ticketId: string, levelNumber: number) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    include: {
      project: { select: { name: true, code: true, locationId: true } },
      item: { select: { name: true } },
      steps: { where: { levelNumber }, include: { approvers: true } },
    },
  });
  const step = ticket?.steps[0];
  if (!ticket || !step) return;

  const ctx = { projectId: ticket.projectId, locationId: ticket.project.locationId };
  const namedIds = step.approvers.flatMap((a) => (a.approverType === ApproverType.USER && a.userId ? [a.userId] : []));
  const typeIds = step.approvers.flatMap((a) => (a.approverType === ApproverType.USER_TYPE && a.userTypeId ? [a.userTypeId] : []));
  const candidates = await prisma.user.findMany({
    where: { isActive: true, userType: { code: { not: USER_TYPE.ADMIN } }, OR: [...(namedIds.length ? [{ id: { in: namedIds } }] : []), ...(typeIds.length ? [{ userTypeId: { in: typeIds } }] : [])] },
    select: { id: true, name: true, email: true, userTypeId: true, assignments: { select: ASSIGNMENT_SCOPE_SELECT } },
  });
  const recipients = candidates.filter((candidate) => namedIds.includes(candidate.id) || (typeIds.includes(candidate.userTypeId) && candidate.assignments.some((a) => assignmentCoversProject(a, ctx))));
  if (recipients.length === 0) return;

  const { sendEmail } = await import("@/lib/mail");
  const { appConfig } = await import("@/lib/env");
  const url = `${appConfig.appUrl().replace(/\/$/, "")}/maintenance`;
  const html = `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6"><h2>PMV Workflow</h2><p>A new ticket is awaiting your response.</p><p><b>Ticket:</b> ${escapeHtml(ticket.ticketNumber)}<br><b>Project:</b> ${escapeHtml(ticket.project.code)} - ${escapeHtml(ticket.project.name)}<br><b>Item:</b> ${escapeHtml(ticket.item.name)}<br><b>Level:</b> ${levelNumber} - ${escapeHtml(step.name)}</p><p><a href="${escapeHtml(url)}">Open maintenance tickets</a></p></div>`;
  await Promise.allSettled(recipients.map((recipient) => sendEmail({ to: recipient.email, subject: "A new ticket is awaiting your response", html })));
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ---------------------------------------------------------------------------------------------------------------------
// Ticket number: MNT-YYYY-0001, 0002, ...
// ---------------------------------------------------------------------------------------------------------------------

export async function nextTicketNumber(year = new Date().getFullYear()): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(SUBSTRING("ticketNumber" FROM 10) AS INTEGER))::int AS max
    FROM "MaintenanceTicket"
    WHERE "ticketNumber" ~ ${`^MNT-${year}-[0-9]{1,8}$`}`;
  const next = (rows[0]?.max ?? 0) + 1;
  return `MNT-${year}-${String(next).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Serialising a ticket for the browser
// ---------------------------------------------------------------------------------------------------------------------

export const maintenanceTicketInclude = {
  project: { select: { id: true, code: true, name: true, locationId: true } },
  item: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true, email: true } },
  steps: {
    orderBy: { levelNumber: "asc" as const },
    include: { actedBy: { select: { name: true } }, approvers: { include: { user: { select: { name: true } }, userType: { select: { name: true } } } } },
  },
  attachments: { orderBy: { createdAt: "asc" as const }, select: { id: true, originalName: true, mimeType: true, fileSize: true, createdAt: true } },
} satisfies Prisma.MaintenanceTicketInclude;

export type TicketWithRelations = Prisma.MaintenanceTicketGetPayload<{ include: typeof maintenanceTicketInclude }>;

export function serializeMaintenanceTicket(ticket: TicketWithRelations) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    requestType: ticket.requestType,
    units: ticket.units,
    phoneNumber: ticket.phoneNumber,
    description: ticket.description,
    status: ticket.status,
    currentLevel: ticket.currentLevel,
    createdAt: ticket.createdAt.toISOString(),
    closedAt: ticket.closedAt?.toISOString() ?? null,
    project: { id: ticket.project.id, code: ticket.project.code, name: ticket.project.name },
    item: ticket.item,
    requester: ticket.requester,
    steps: ticket.steps.map((step) => ({
      id: step.id,
      levelNumber: step.levelNumber,
      name: step.name,
      status: step.status,
      actedAt: step.actedAt?.toISOString() ?? null,
      actedBy: step.actedBy,
      approvers: step.approvers.map((a) => ({ approverType: a.approverType, user: a.user, userType: a.userType })),
    })),
    attachments: ticket.attachments.map((file) => ({ ...file, createdAt: file.createdAt.toISOString() })),
  };
}
