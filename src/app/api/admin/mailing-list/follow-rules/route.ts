// src/app/api/admin/mailing-list/follow-rules/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiAdmin, str } from "@/lib/admin-api";
import type { MailDelivery } from "@/lib/mailing-list-config";
import { describeAccessProblem, findMissingAccess } from "@/lib/workflow/mailing-list";
import type { UserTypeCode } from "@/lib/auth/roles";

export const runtime = "nodejs";

const SCOPES = ["OWN_UPLOADS", "ACCESSIBLE"] as const;
const EVENTS = ["UPLOADED", "APPROVED"] as const;
const DELIVERIES: MailDelivery[] = ["OFF", "DIGEST", "INSTANT"];

const ruleSelect = {
  id: true,
  userId: true,
  scope: true,
  documentTypeId: true,
  events: true,
  delivery: true,
  user: { select: { name: true, email: true } },
  documentType: { select: { name: true } },
} as const;

/** The follow-up rules: "email this person when a document of this type is uploaded / approved in the same process". */
export async function GET(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;
  const rules = await prisma.mailFollowRule.findMany({ select: ruleSelect, orderBy: [{ user: { name: "asc" } }, { createdAt: "asc" }] });
  return NextResponse.json({ rules });
}

/** Create a rule, or change one (send its id). */
export async function PUT(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const userId = str(body?.userId);
  const scope = str(body?.scope) as (typeof SCOPES)[number];
  const documentTypeId = str(body?.documentTypeId);
  const delivery = body?.delivery === null || body?.delivery === undefined || body?.delivery === "" ? null : (str(body?.delivery) as MailDelivery);
  const rawEvents = Array.isArray(body?.events) ? (body?.events as unknown[]) : [];
  const events = [...new Set(rawEvents.filter((value): value is (typeof EVENTS)[number] => EVENTS.includes(value as (typeof EVENTS)[number])))];

  if (!userId || !documentTypeId) return NextResponse.json({ message: "Choose a person and a document type." }, { status: 400 });
  if (!SCOPES.includes(scope)) return NextResponse.json({ message: "Choose which documents of the process the person is following." }, { status: 400 });
  if (events.length === 0) return NextResponse.json({ message: "Choose at least one event (uploaded or approved)." }, { status: 400 });
  if (delivery !== null && !DELIVERIES.includes(delivery)) return NextResponse.json({ message: "Choose Off, Summary email or Instant." }, { status: 400 });

  const [user, type] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isActive: true, userType: { select: { code: true } } } }),
    prisma.documentType.findUnique({ where: { id: documentTypeId }, select: { id: true, isActive: true } }),
  ]);
  if (!user || !user.isActive) return NextResponse.json({ message: "This person does not exist or is not active." }, { status: 400 });
  if (!type || !type.isActive) return NextResponse.json({ message: "This document type does not exist or is not active." }, { status: 400 });

  // Same check as the "any document" lists: the person must be able to open documents of this type.
  const problem = await findMissingAccess(prisma, { id: user.id, userType: user.userType.code as UserTypeCode }, { projectIds: [], documentTypeIds: [documentTypeId], documentSubtypeIds: [] });
  const message = describeAccessProblem(user.name, problem);
  if (message) return NextResponse.json({ message, missingAccess: problem }, { status: 422 });

  try {
    const data = { userId, scope, documentTypeId, events, delivery };
    const rule = id
      ? await prisma.mailFollowRule.update({ where: { id }, data, select: ruleSelect })
      : await prisma.mailFollowRule.create({ data, select: ruleSelect });
    return NextResponse.json({ rule });
  } catch (error) {
    return prismaErrorResponse(error, {
      duplicate: "This person already has a rule for this document type with the same choice of documents. Edit that rule instead.",
      reference: "The person, document type or rule no longer exists. Reload the page.",
    }) ?? NextResponse.json({ message: "Unable to save the rule." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;
  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Rule id is required." }, { status: 400 });
  await prisma.mailFollowRule.deleteMany({ where: { id } });
  return NextResponse.json({ message: "Rule removed." });
}
