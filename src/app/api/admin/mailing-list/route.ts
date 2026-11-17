// src/app/api/admin/mailing-list/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiAdmin, str } from "@/lib/admin-api";
import { MAIL_KINDS, MAIL_KIND_KEYS, RULE_KINDS, WATCH_KINDS, type MailDelivery, type MailKind } from "@/lib/mailing-list-config";
import { describeAccessProblem, findMissingAccess, loadDigestIntervalHours, loadMailDefaults } from "@/lib/workflow/mailing-list";
import type { UserTypeCode } from "@/lib/auth/roles";

export const runtime = "nodejs";

const DELIVERIES: MailDelivery[] = ["OFF", "DIGEST", "INSTANT"];

const settingSelect = { id: true, userId: true, kind: true, delivery: true, projectIds: true, documentTypeIds: true, documentSubtypeIds: true } as const;

const idList = (value: unknown): string[] | null => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return [...new Set((value as string[]).map((item) => item.trim()).filter(Boolean))];
};

/** Everything the Mailing List page shows: people, their settings, the defaults and what can be picked. */
export async function GET(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;

  const [users, settings, defaults, digestIntervalHours, projects, documentTypes] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, emailNotificationsDisabled: true, userType: { select: { code: true, name: true } } },
    }),
    prisma.mailSetting.findMany({ select: settingSelect }),
    loadMailDefaults(prisma),
    loadDigestIntervalHours(prisma),
    prisma.project.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.documentType.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, subtypes: { where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } } },
    }),
  ]);
  return NextResponse.json({ users, settings, defaults, digestIntervalHours, projects, documentTypes });
}

/**
 * Save one person's setting for one kind of email (delivery and limits). For the "any document" kinds the projects and
 * document types must be ones the person can open; otherwise the save is refused with a message that says which
 * permission to give them first.
 */
export async function PUT(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const userId = str(body?.userId);
  const kind = str(body?.kind) as MailKind;
  const delivery = body?.delivery === null || body?.delivery === undefined || body?.delivery === "" ? null : (str(body?.delivery) as MailDelivery);
  const projectIds = idList(body?.projectIds);
  const documentTypeIds = idList(body?.documentTypeIds);
  const documentSubtypeIds = idList(body?.documentSubtypeIds);

  if (!userId || !MAIL_KIND_KEYS.includes(kind) || RULE_KINDS.includes(kind)) return NextResponse.json({ message: "Choose a person and a kind of email." }, { status: 400 });
  if (delivery !== null && !DELIVERIES.includes(delivery)) return NextResponse.json({ message: "Choose Off, Summary email or Instant." }, { status: 400 });
  if (!projectIds || !documentTypeIds || !documentSubtypeIds) return NextResponse.json({ message: "Projects and document types must be lists of ids." }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isActive: true, userType: { select: { code: true } } } });
  if (!user || !user.isActive) return NextResponse.json({ message: "This person does not exist or is not active." }, { status: 400 });

  const [projectCount, typeCount, subtypeCount] = await Promise.all([
    prisma.project.count({ where: { id: { in: projectIds } } }),
    prisma.documentType.count({ where: { id: { in: documentTypeIds } } }),
    prisma.documentSubtype.count({ where: { id: { in: documentSubtypeIds } } }),
  ]);
  if (projectCount !== projectIds.length || typeCount !== documentTypeIds.length || subtypeCount !== documentSubtypeIds.length) {
    return NextResponse.json({ message: "A chosen project or document type no longer exists. Reload the page." }, { status: 400 });
  }

  if (WATCH_KINDS.includes(kind)) {
    const problem = await findMissingAccess(prisma, { id: user.id, userType: user.userType.code as UserTypeCode }, { projectIds, documentTypeIds, documentSubtypeIds });
    const message = describeAccessProblem(user.name, problem);
    if (message) return NextResponse.json({ message, missingAccess: problem }, { status: 422 });
  }

  try {
    const setting = await prisma.mailSetting.upsert({
      where: { userId_kind: { userId, kind } },
      create: { userId, kind, delivery, projectIds, documentTypeIds, documentSubtypeIds },
      update: { delivery, projectIds, documentTypeIds, documentSubtypeIds },
      select: settingSelect,
    });
    return NextResponse.json({ setting });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to save the setting." }, { status: 500 });
  }
}

/** Remove a person's setting: involved kinds go back to the default, "any document" kinds take the person off the list. */
export async function DELETE(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const userId = str(body?.userId);
  const kind = str(body?.kind) as MailKind;
  if (!userId || !MAIL_KIND_KEYS.includes(kind)) return NextResponse.json({ message: "Choose a person and a kind of email." }, { status: 400 });

  await prisma.mailSetting.deleteMany({ where: { userId, kind } });
  return NextResponse.json({ message: MAIL_KINDS[kind].involvement ? "Back to the default." : "Removed from this list." });
}
