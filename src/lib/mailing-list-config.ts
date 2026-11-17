// The kinds of email the system can send and how they are delivered. Plain data only (no database code), so the
// Mailing List page in the browser and the server share it. The mailing list is managed on its own page:
// it does not depend on roles or permissions.

export type MailDelivery = "OFF" | "DIGEST" | "INSTANT";

/** Hours between two summary emails to the same person (set on the Mailing List page). */
export const DEFAULT_DIGEST_INTERVAL_HOURS = 1;
export const MIN_DIGEST_INTERVAL_HOURS = 1;
export const MAX_DIGEST_INTERVAL_HOURS = 168;

export const MAIL_DELIVERY_LABELS: Record<MailDelivery, string> = {
  OFF: "Off",
  DIGEST: "Summary email",
  INSTANT: "Instant",
};

export const MAIL_DELIVERY_HELP: Record<MailDelivery, string> = {
  OFF: "No email (the in-app notification is not affected for involved kinds).",
  DIGEST: "Included in the person's summary email, sent at most once per summary interval (set above).",
  INSTANT: "Its own email as soon as it happens (held until 06:00 Kuwait time during quiet hours 18:00-06:00).",
};

export const MAIL_KINDS = {
  AWAITING_REVIEW: {
    group: "My tasks",
    label: "Documents awaiting my review",
    description: "Documents waiting for the person's approval, or sent back to them for revision.",
    audience: "Sent to the people the approval flow names for the current level.",
    defaultDelivery: "DIGEST",
    involvement: true,
  },
  AWAITING_UPLOAD: {
    group: "My tasks",
    label: "Documents awaiting my upload",
    description: "A process run is waiting for a next document the person may upload.",
    audience: "Sent to the people who may upload the next document of a run.",
    defaultDelivery: "DIGEST",
    involvement: true,
  },
  OWN_APPROVED: {
    group: "My documents",
    label: "My document fully approved",
    description: "A document the person uploaded has been fully approved.",
    audience: "Sent to the person who uploaded the document.",
    defaultDelivery: "OFF",
    involvement: true,
  },
  OWN_REJECTED: {
    group: "My documents",
    label: "My document rejected",
    description: "A document the person uploaded has been rejected.",
    audience: "Sent to the person who uploaded the document.",
    defaultDelivery: "OFF",
    involvement: true,
  },
  OWN_REVISION: {
    group: "My documents",
    label: "My document sent back for revision",
    description: "A document the person uploaded was sent back for revision.",
    audience: "Sent to the person who uploaded the document.",
    defaultDelivery: "OFF",
    involvement: true,
  },
  WATCH_APPROVED: {
    group: "Following other documents",
    label: "Any document fully approved",
    description: "Any document inside the person's projects and document types is fully approved.",
    audience: "Only people added here. Documents they cannot open are never sent.",
    defaultDelivery: "DIGEST",
    involvement: false,
  },
  WATCH_REJECTED: {
    group: "Following other documents",
    label: "Any document rejected",
    description: "Any document inside the person's projects and document types is rejected.",
    audience: "Only people added here. Documents they cannot open are never sent.",
    defaultDelivery: "DIGEST",
    involvement: false,
  },
  WATCH_REVISION: {
    group: "Following other documents",
    label: "Any document sent back for revision",
    description: "Any document inside the person's projects and document types is sent back for revision.",
    audience: "Only people added here. Documents they cannot open are never sent.",
    defaultDelivery: "DIGEST",
    involvement: false,
  },
  PROCESS_UPLOADED: {
    group: "Process follow-ups",
    label: "Follow-up document uploaded in my process",
    description: "A document of a chosen type is uploaded in the same process run as a document the person uploaded or can open. Set per person as rules below.",
    audience: "Only people with a follow-up rule. Documents they cannot open are never sent.",
    defaultDelivery: "DIGEST",
    involvement: false,
  },
  PROCESS_APPROVED: {
    group: "Process follow-ups",
    label: "Follow-up document approved in my process",
    description: "A document of a chosen type is fully approved in the same process run as a document the person uploaded or can open. Set per person as rules below.",
    audience: "Only people with a follow-up rule. Documents they cannot open are never sent.",
    defaultDelivery: "DIGEST",
    involvement: false,
  },
} as const;

export type MailKind = keyof typeof MAIL_KINDS;
export const MAIL_KIND_KEYS = Object.keys(MAIL_KINDS) as MailKind[];
export const MAIL_KIND_GROUPS = ["My tasks", "My documents", "Following other documents", "Process follow-ups"] as const;
/** Per-person groups (the "Process follow-ups" group is managed as rules, not as a per-kind setting). */
export const MAIL_PERSON_GROUPS = ["My tasks", "My documents", "Following other documents"] as const;

/** The kinds that come from follow-up rules (process runs), not from a per-person setting. */
export const RULE_KINDS: MailKind[] = ["PROCESS_UPLOADED", "PROCESS_APPROVED"];

/** Kinds where being on the list is the setting itself (nobody is on them by default). */
export const WATCH_KINDS: MailKind[] = MAIL_KIND_KEYS.filter((kind) => !MAIL_KINDS[kind].involvement && !["PROCESS_UPLOADED", "PROCESS_APPROVED"].includes(kind));

/** What happened to a document. The engine uses it to find the matching "any document" kind. */
export type MailEvent = "APPROVED" | "REJECTED" | "REVISION";
export const WATCH_KIND_FOR_EVENT: Record<MailEvent, MailKind> = {
  APPROVED: "WATCH_APPROVED",
  REJECTED: "WATCH_REJECTED",
  REVISION: "WATCH_REVISION",
};

export type MailKindDefaults = Record<MailKind, MailDelivery>;
export const BUILT_IN_MAIL_DEFAULTS = Object.fromEntries(MAIL_KIND_KEYS.map((kind) => [kind, MAIL_KINDS[kind].defaultDelivery])) as MailKindDefaults;

/** The limits of one person's setting. Empty lists mean "everything they may access". */
export type MailScope = { projectIds: string[]; documentTypeIds: string[]; documentSubtypeIds: string[] };
export type MailDocumentRef = { projectId: string | null; documentTypeId: string; documentSubtypeId: string | null };

/** Does a document fall inside the limits? A type id covers its sub types; a sub type id covers only itself. */
export function scopeCoversDocument(scope: MailScope, doc: MailDocumentRef): boolean {
  if (scope.projectIds.length > 0 && !(doc.projectId && scope.projectIds.includes(doc.projectId))) return false;
  if (scope.documentTypeIds.length === 0 && scope.documentSubtypeIds.length === 0) return true;
  return scope.documentTypeIds.includes(doc.documentTypeId) || Boolean(doc.documentSubtypeId && scope.documentSubtypeIds.includes(doc.documentSubtypeId));
}

export type MailFollowScopeValue = "OWN_UPLOADS" | "ACCESSIBLE";
export type MailFollowEventValue = "UPLOADED" | "APPROVED";
export const MAIL_FOLLOW_SCOPE_LABELS: Record<MailFollowScopeValue, string> = {
  OWN_UPLOADS: "Processes with a document the person uploaded",
  ACCESSIBLE: "Processes with a document the person can open",
};
export const MAIL_FOLLOW_EVENT_LABELS: Record<MailFollowEventValue, string> = { UPLOADED: "Uploaded", APPROVED: "Approved" };
