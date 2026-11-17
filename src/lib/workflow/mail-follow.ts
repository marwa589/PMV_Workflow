import "server-only";

import type { MailDelivery, MailFollowEvent } from "@prisma/client";
import { canAccessDocument, type Db } from "@/lib/auth/access";
import type { UserTypeCode } from "@/lib/auth/roles";
import { loadMailDefaults } from "@/lib/workflow/mailing-list";
import type { WorkflowEffects } from "@/lib/workflow/engine";
import { EmailEventType } from "@prisma/client";

export type FollowRecipient = { id: string; delivery: MailDelivery };

const KIND_FOR_EVENT = { UPLOADED: "PROCESS_UPLOADED", APPROVED: "PROCESS_APPROVED" } as const;
const EMAIL_TYPE_FOR_EVENT = { UPLOADED: EmailEventType.PROCESS_DOCUMENT_UPLOADED, APPROVED: EmailEventType.WORKFLOW_APPROVED } as const;

/**
 * People whose follow-up rule (Mailing List page) matches this document: it is of the type the rule names, it happened
 * (uploaded / approved) in a process run, and that run holds another document the person uploaded ("OWN_UPLOADS") or can
 * open ("ACCESSIBLE"), depending on what the admin chose for the rule. People who cannot open the document itself are
 * never included, and neither is a rule whose delivery is Off.
 */
export async function getFollowRecipients(db: Db, event: MailFollowEvent, documentId: string): Promise<FollowRecipient[]> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { id: true, documentTypeId: true, isReference: true, processLinks: { where: { isCurrent: true }, select: { processInstanceId: true } } },
  });
  if (!document || document.isReference) return [];
  const runIds = [...new Set(document.processLinks.map((link) => link.processInstanceId))];
  if (runIds.length === 0) return [];

  const rules = await db.mailFollowRule.findMany({
    where: { documentTypeId: document.documentTypeId, events: { has: event }, user: { isActive: true } },
    select: { userId: true, scope: true, delivery: true, user: { select: { id: true, email: true, userType: { select: { code: true } } } } },
  });
  if (rules.length === 0) return [];

  const [defaults, others] = await Promise.all([
    loadMailDefaults(db),
    db.processStepDocument.findMany({
      where: { processInstanceId: { in: runIds }, isCurrent: true, documentId: { not: document.id } },
      select: { document: { select: { id: true, createdById: true } } },
    }),
  ]);
  const otherDocuments = [...new Map(others.map((link) => [link.document.id, link.document])).values()];
  if (otherDocuments.length === 0) return [];

  const kind = KIND_FOR_EVENT[event];
  const result = new Map<string, FollowRecipient>();
  for (const rule of rules) {
    if (!rule.user.email || result.has(rule.userId)) continue;
    const delivery = rule.delivery ?? defaults[kind];
    if (delivery === "OFF") continue;
    const actor = { userId: rule.userId, userType: rule.user.userType.code as UserTypeCode };

    let related = false;
    if (rule.scope === "OWN_UPLOADS") {
      related = otherDocuments.some((other) => other.createdById === rule.userId);
    } else {
      for (const other of otherDocuments) {
        if (await canAccessDocument(actor, other.id, "documents.view", db)) {
          related = true;
          break;
        }
      }
    }
    if (!related) continue;
    // The email links to the document: never send one the person cannot open.
    if (!(await canAccessDocument(actor, document.id, "documents.view", db))) continue;
    result.set(rule.userId, { id: rule.userId, delivery });
  }
  return [...result.values()];
}

/**
 * Adds the follow-up emails of an event to the effects. The person who acted is skipped; someone who already gets an
 * email about this document for another reason gets one email only (see queueWorkflowEmailEvents).
 */
export async function notifyProcessFollowers(
  db: Db,
  documentId: string,
  event: MailFollowEvent,
  effects: WorkflowEffects,
  actedBy: Array<string | null | undefined>,
) {
  const recipients = await getFollowRecipients(db, event, documentId);
  const alreadyTold = new Set<string>(actedBy.filter((id): id is string => Boolean(id)));
  for (const recipient of recipients) {
    if (alreadyTold.has(recipient.id)) continue;
    effects.emailEvents.push({ recipientId: recipient.id, type: EMAIL_TYPE_FOR_EVENT[event], documentId, kind: KIND_FOR_EVENT[event], delivery: recipient.delivery });
  }
}
