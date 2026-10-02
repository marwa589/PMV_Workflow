import "server-only";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { isRestrictedClerk } from "@/lib/auth/resource-access";

const ERRO_EMAIL = "dispatcher.pmv@ahmadiah.com";
const GROUP_B_UPLOADER_EMAILS = new Set([
  "joemar.paraiso@ahmadiah.com",
  "bernabie.rocha@ahmadiah.com",
  "mohamed.mahran@ahmadiah.com",
]);
const GROUP_A_RECIPIENT_EMAILS = [ERRO_EMAIL, "mohammad.mehieddine@ahmadiah.com"];
const GROUP_B_RECIPIENT_EMAILS = ["joemar.paraiso@ahmadiah.com", ERRO_EMAIL, "bernabie.rocha@ahmadiah.com", "mohamed.mahran@ahmadiah.com"];
const GROUP_C_RECIPIENT_EMAILS = ["mohamed.shawky@ahmadiah.com", "mohamed.mahmoud@ahmadiah.com", "jad.kabalan@ahmadiah.com", "muneer.kottappuram@ahmadiah.com"];
const MUNEER_EMAIL = "muneer.kottappuram@ahmadiah.com";
const PO_GLOBAL_VIEWER_EMAILS = new Set([
  "george.azzi@ahmadiah.com",
  "marc.baddour@ahmadiah.com",
  "jad.kabalan@ahmadiah.com",
]);

export function isOmar(user: { email?: string | null }): boolean {
  return user.email?.trim().toLowerCase() === "omar.merzek@ahmadiah.com";
}

export function isMuneer(user: { email?: string | null }): boolean {
  return user.email?.trim().toLowerCase() === MUNEER_EMAIL;
}

export function isGlobalPurchaseOrderViewer(user: { role: UserRole; email?: string | null }): boolean {
  const email = user.email?.trim().toLowerCase();
  return user.role === UserRole.ADMIN || isOmar(user) || Boolean(email && PO_GLOBAL_VIEWER_EMAILS.has(email));
}

function normalizeEmail(email: string) { return email.trim().toLowerCase(); }

function recipientEmailsForUploader(email: string): string[] {
  const normalized = normalizeEmail(email);
  if (normalized === ERRO_EMAIL) return GROUP_A_RECIPIENT_EMAILS;
  if (GROUP_B_UPLOADER_EMAILS.has(normalized)) return GROUP_B_RECIPIENT_EMAILS;
  return GROUP_C_RECIPIENT_EMAILS;
}

type PoAccessDb = Pick<Prisma.TransactionClient, "purchaseOrderMrLink" | "user">;

async function resolvePurchaseOrderRecipientIds(tx: PoAccessDb, poId: string) {
  const links = await tx.purchaseOrderMrLink.findMany({
    where: { purchaseOrderId: poId },
    select: { document: { select: { createdBy: { select: { email: true } } } } },
  });
  if (links.length === 0) return [];

  const emails = new Set<string>();
  for (const link of links) {
    const uploaderEmail = link.document.createdBy?.email;
    if (!uploaderEmail) throw new Error("A related MR uploader could not be resolved.");
    for (const email of recipientEmailsForUploader(uploaderEmail)) emails.add(normalizeEmail(email));
  }

  for (const email of PO_GLOBAL_VIEWER_EMAILS) {
    emails.add(normalizeEmail(email));
  }

  const recipients = await tx.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true, email: true } });
  const found = new Set(recipients.map((user) => normalizeEmail(user.email)));
  const missing = [...emails].filter((email) => !found.has(email));
  if (missing.length > 0) throw new Error(`Purchase order recipient account(s) are missing: ${missing.join(", ")}`);
  return recipients.map((user) => user.id);
}

export async function getPurchaseOrderRecipientIds(poId: string) { return resolvePurchaseOrderRecipientIds(prisma, poId); }

export async function canViewPurchaseOrder(user: { userId: string; role: UserRole; email?: string | null }, poId: string) {
  if (isGlobalPurchaseOrderViewer(user)) return true;

  const [viewer, linkedMrs] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.userId }, select: { location: true } }),
    prisma.purchaseOrderMrLink.findMany({
      where: { purchaseOrderId: poId },
      select: { document: { select: { createdBy: { select: { location: true } } } } },
    }),
  ]);

  if (!viewer?.location || linkedMrs.length === 0) {
    return isRestrictedClerk(user) && (await getPurchaseOrderRecipientIds(poId)).includes(user.userId);
  }

  return linkedMrs.some((link) => link.document.createdBy.location === viewer.location);
}

export async function getPurchaseOrderLocations(poId: string) {
  const links = await prisma.purchaseOrderMrLink.findMany({
    where: { purchaseOrderId: poId },
    select: { document: { select: { createdBy: { select: { location: true } } } } },
  });
  return new Set(links.map((link) => link.document.createdBy.location).filter((location): location is NonNullable<typeof location> => Boolean(location)));
}

export async function resolvePurchaseOrderRecipients(tx: PoAccessDb, poId: string) {
  return resolvePurchaseOrderRecipientIds(tx, poId);
}

export function canViewPurchaseOrdersSidebar(role: UserRole) {
  return role === UserRole.CLERK
    || role === UserRole.APPROVER_1
    || role === UserRole.APPROVER_2
    || role === UserRole.APPROVER_3
    || role === UserRole.ADMIN;
}
