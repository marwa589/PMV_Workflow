import "server-only";

import { ASSIGNMENT_SCOPE_SELECT, assignmentMatchesScope, type Db, type ScopeContext } from "@/lib/auth/access";
import { MAIL_EVENTS, type MailEvent } from "@/lib/mailing-list-config";

export type MailingListMember = { id: string; name: string; email: string };

/**
 * Active users holding the "receive mail" permission for this event through an assignment that covers the document's scope.
 * Admin users are not included just for being admin: only an explicit assignment puts someone on the list.
 */
export async function getMailingListRecipients(db: Db, event: MailEvent, scope: ScopeContext): Promise<MailingListMember[]> {
  const assignments = await db.userAssignment.findMany({
    where: {
      user: { isActive: true },
      role: { permissions: { some: { permission: { code: MAIL_EVENTS[event].permission } } } },
    },
    select: { user: { select: { id: true, name: true, email: true } }, ...ASSIGNMENT_SCOPE_SELECT },
  });

  const members = new Map<string, MailingListMember>();
  for (const assignment of assignments) {
    if (!assignment.user.email || members.has(assignment.user.id)) continue;
    if (assignmentMatchesScope(assignment, scope)) members.set(assignment.user.id, assignment.user);
  }
  return [...members.values()];
}
