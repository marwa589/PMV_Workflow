// The mailing list is not a separate table: being "on the list" means holding one of these permissions
// through a role assignment, so it is scoped by project / location / document type / sub type like everything else.
export const MAIL_EVENTS = {
  APPROVED: { permission: "mail.receive_approved", label: "Approved", description: "A document is fully approved" },
  REJECTED: { permission: "mail.receive_rejected", label: "Rejected", description: "A document is rejected" },
  REVISION: { permission: "mail.receive_revision", label: "Revision requested", description: "A document is sent back for revision" },
} as const;

export type MailEvent = keyof typeof MAIL_EVENTS;
export const MAIL_EVENT_KEYS = Object.keys(MAIL_EVENTS) as MailEvent[];
export const MAIL_PERMISSION_CODES: string[] = MAIL_EVENT_KEYS.map((event) => MAIL_EVENTS[event].permission);
