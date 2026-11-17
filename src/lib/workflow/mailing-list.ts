import "server-only";

import { ASSIGNMENT_SCOPE_SELECT, assignmentMatchesScope, canAccessDocument, type AssignmentScope, type Db } from "@/lib/auth/access";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";
import {
  BUILT_IN_MAIL_DEFAULTS,
  DEFAULT_DIGEST_INTERVAL_HOURS,
  MAX_DIGEST_INTERVAL_HOURS,
  MIN_DIGEST_INTERVAL_HOURS,
  WATCH_KIND_FOR_EVENT,
  scopeCoversDocument,
  type MailDelivery,
  type MailDocumentRef,
  type MailEvent,
  type MailKind,
  type MailKindDefaults,
  type MailScope,
} from "@/lib/mailing-list-config";

export type MailSettingRow = MailScope & { userId: string; kind: MailKind; delivery: MailDelivery | null };
export type MailingListMember = { id: string; name: string; email: string; delivery: MailDelivery };

/** Hours between two summary emails to the same person (editable on the Mailing List page; default 1). */
export async function loadDigestIntervalHours(db: Db): Promise<number> {
  const row = await db.mailDigestConfig.findUnique({ where: { id: "global" }, select: { intervalHours: true } });
  const hours = row?.intervalHours ?? DEFAULT_DIGEST_INTERVAL_HOURS;
  return Math.min(MAX_DIGEST_INTERVAL_HOURS, Math.max(MIN_DIGEST_INTERVAL_HOURS, Math.round(hours)));
}

/** How each kind is delivered unless a person has their own setting (editable on the Mailing List page). */
export async function loadMailDefaults(db: Db): Promise<MailKindDefaults> {
  const rows = await db.mailKindDefault.findMany({ select: { kind: true, delivery: true } });
  const defaults: MailKindDefaults = { ...BUILT_IN_MAIL_DEFAULTS };
  for (const row of rows) defaults[row.kind] = row.delivery;
  return defaults;
}

/**
 * What a person gets for one kind of email about one document.
 *  - Involvement kinds (review, upload, own documents): the person is involved already, so no setting = the default.
 *    A setting changes the delivery and may limit the documents; outside its limits the answer is OFF.
 *  - "Any document" kinds: no setting = not on the list = OFF.
 */
export function effectiveDelivery(
  setting: MailSettingRow | undefined,
  kind: MailKind,
  defaults: MailKindDefaults,
  doc: MailDocumentRef | null,
  involvement: boolean,
): MailDelivery {
  if (!setting) return involvement ? defaults[kind] : "OFF";
  if (doc && !scopeCoversDocument(setting, doc)) return "OFF";
  return setting.delivery ?? defaults[kind];
}

export async function loadMailSettings(db: Db, userIds: string[], kinds: MailKind[]): Promise<Map<string, MailSettingRow>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.mailSetting.findMany({
    where: { userId: { in: userIds }, kind: { in: kinds } },
    select: { userId: true, kind: true, delivery: true, projectIds: true, documentTypeIds: true, documentSubtypeIds: true },
  });
  return new Map(rows.map((row) => [`${row.userId}|${row.kind}`, row]));
}

/**
 * People on the "any document ..." list for this event whose setting covers the document and who may open it.
 * Their delivery is already worked out (OFF people are left out). Being an Admin user is not enough to be on the list.
 */
export async function getWatchRecipients(
  db: Db,
  event: MailEvent,
  doc: MailDocumentRef & { id: string },
): Promise<MailingListMember[]> {
  const kind = WATCH_KIND_FOR_EVENT[event];
  const [defaults, rows] = await Promise.all([
    loadMailDefaults(db),
    db.mailSetting.findMany({
      where: { kind, user: { isActive: true } },
      select: {
        userId: true, kind: true, delivery: true, projectIds: true, documentTypeIds: true, documentSubtypeIds: true,
        user: { select: { id: true, name: true, email: true, userType: { select: { code: true } } } },
      },
    }),
  ]);

  const members: MailingListMember[] = [];
  for (const row of rows) {
    if (!row.user.email) continue;
    const delivery = effectiveDelivery(row, kind, defaults, doc, false);
    if (delivery === "OFF") continue;
    // The email links to the document: never send one the person cannot open.
    const allowed = await canAccessDocument({ userId: row.user.id, userType: row.user.userType.code as UserTypeCode }, doc.id, "documents.view", db);
    if (!allowed) continue;
    members.push({ id: row.user.id, name: row.user.name, email: row.user.email, delivery });
  }
  return members;
}

export type AccessProblem = { projects: string[]; types: string[]; subtypes: string[] };

/**
 * Checks the projects and document types an admin picked for a person's "any document" list against what the person
 * may open ("View documents" through an assignment). Returns what is NOT covered, empty when everything is.
 * An empty selection means "everything they can access" and is never a problem.
 */
export async function findMissingAccess(
  db: Db,
  user: { id: string; userType: UserTypeCode },
  scope: MailScope,
): Promise<AccessProblem> {
  const none: AccessProblem = { projects: [], types: [], subtypes: [] };
  if (user.userType === USER_TYPE.ADMIN) return none;
  if (scope.projectIds.length === 0 && scope.documentTypeIds.length === 0 && scope.documentSubtypeIds.length === 0) return none;

  const [assignmentRows, projects, types, subtypes] = await Promise.all([
    db.userAssignment.findMany({
      where: { userId: user.id, role: { permissions: { some: { permission: { code: "documents.view" } } } } },
      select: ASSIGNMENT_SCOPE_SELECT,
    }),
    scope.projectIds.length ? db.project.findMany({ where: { id: { in: scope.projectIds } }, select: { id: true, code: true, locationId: true, companyId: true } }) : [],
    scope.documentTypeIds.length ? db.documentType.findMany({ where: { id: { in: scope.documentTypeIds } }, select: { id: true, name: true } }) : [],
    scope.documentSubtypeIds.length ? db.documentSubtype.findMany({ where: { id: { in: scope.documentSubtypeIds } }, select: { id: true, name: true, documentTypeId: true } }) : [],
  ]);
  const assignments = assignmentRows;

  // Only the parts the admin picked are checked: a dimension left empty is cleared from the assignment before matching.
  const covered = (project: { id: string; locationId: string | null; companyId: string | null } | null, type: { typeId: string; subtypeId: string | null } | null) =>
    assignments.some((assignment) => {
      const limited: AssignmentScope = {
        ...assignment,
        ...(project ? {} : { companyId: null, projectId: null, locationId: null, projectScopes: [] }),
        ...(type ? {} : { documentTypeId: null, documentSubtypeId: null, documentTypeScopes: [] }),
      };
      return assignmentMatchesScope(limited, {
        projectId: project?.id ?? null,
        locationId: project?.locationId ?? null,
        companyId: project?.companyId ?? null,
        documentTypeId: type?.typeId ?? null,
        documentSubtypeId: type?.subtypeId ?? null,
      });
    });

  const problem: AccessProblem = { projects: [], types: [], subtypes: [] };
  // Each picked project, each picked type and each picked sub type has to be reachable on its own.
  for (const project of projects) if (!covered(project, null)) problem.projects.push(project.code);
  for (const type of types) if (!covered(null, { typeId: type.id, subtypeId: null })) problem.types.push(type.name);
  for (const subtype of subtypes) if (!covered(null, { typeId: subtype.documentTypeId, subtypeId: subtype.id })) problem.subtypes.push(subtype.name);
  // A project and a type that are each reachable but never together (for example two separate assignments) are not covered either.
  if (problem.projects.length === 0 && problem.types.length === 0 && problem.subtypes.length === 0 && projects.length > 0) {
    const combos = [
      ...types.map((type) => ({ typeId: type.id, subtypeId: null as string | null })),
      ...subtypes.map((subtype) => ({ typeId: subtype.documentTypeId, subtypeId: subtype.id as string | null })),
    ];
    for (const project of projects) {
      if (combos.length > 0 && !combos.some((combo) => covered(project, combo))) problem.projects.push(project.code);
    }
  }
  return problem;
}

export function describeAccessProblem(personName: string, problem: AccessProblem): string | null {
  const parts = [
    problem.projects.length ? `projects ${problem.projects.join(", ")}` : null,
    problem.types.length ? `document types ${problem.types.join(", ")}` : null,
    problem.subtypes.length ? `sub types ${problem.subtypes.join(", ")}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `${personName} cannot open documents of ${parts.join("; ")}. Give ${personName} a role with the "View documents" permission for them in Roles & Access first, then add them here.`;
}
