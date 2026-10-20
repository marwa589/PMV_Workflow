import "server-only";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { isRestrictedClerk } from "@/lib/auth/resource-access";
import { READY_MIX_KHOBAR_PROJECT_NAME } from "@/lib/ready-mix-mr-access";
import { isKsaViewer, KSA_USER_LOCATIONS } from "@/lib/ksa-viewer";
import { isRamziDocumentApprover } from "@/lib/mohamed-document-workflow";
import { isAvkMrViewer } from "@/lib/avk-access";

export { READY_MIX_KHOBAR_PROJECT_NAME } from "@/lib/ready-mix-mr-access";

const ERRO_EMAIL = "dispatcher.pmv@ahmadiah.com";
export const READY_MIX_KHOBAR_DIRECTOR_EMAIL = "elie.azzam@ahmadiah.com";
const GROUP_B_UPLOADER_EMAILS = new Set([
  "joemar.paraiso@ahmadiah.com",
  "bernabie.rocha@ahmadiah.com",
  "mohamed.mahran@ahmadiah-sa.com",
]);
const GROUP_A_RECIPIENT_EMAILS = [ERRO_EMAIL, "mohammad.mehieddine@ahmadiah.com"];
const GROUP_B_RECIPIENT_EMAILS = ["joemar.paraiso@ahmadiah.com", ERRO_EMAIL, "bernabie.rocha@ahmadiah.com", "mohamed.mahran@ahmadiah-sa.com", "omar.merzek@ahmadiah.com", "marc.baddour@ahmadiah.com", "ramzi@ahmadiah.com"];
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

export function isReadyMixKhobarDirector(user: { email?: string | null }): boolean {
  return user.email?.trim().toLowerCase() === READY_MIX_KHOBAR_DIRECTOR_EMAIL;
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
    select: { document: { select: { projectName: true, createdBy: { select: { email: true, location: true } } } } },
  });
  if (links.length === 0) return [];

  const hasKuwaitMr = links.some(({ document }) =>
    document.projectName !== READY_MIX_KHOBAR_PROJECT_NAME && document.createdBy.location === "KUWAIT",
  );
  const workshopManagers = hasKuwaitMr
    ? await tx.user.findMany({
        where: { role: UserRole.APPROVER_2 },
        select: { id: true },
      })
    : [];
  if (hasKuwaitMr && workshopManagers.length === 0) {
    throw new Error("Purchase order Workshop Manager account is not configured.");
  }

  const emails = new Set<string>();
  const hasAvkMr = links.some(({ document }) => document.createdBy.location === "AVK");
  if (hasAvkMr) {
    const avkUsers = await tx.user.findMany({
      where: { location: "AVK" },
      select: { email: true },
    });
    for (const user of avkUsers) {
      if (user.email) emails.add(normalizeEmail(user.email));
    }
  }

  for (const link of links) {
    const { email: uploaderEmail, location } = link.document.createdBy;
    if (!uploaderEmail) throw new Error("A related MR uploader could not be resolved.");

    if (link.document.projectName === READY_MIX_KHOBAR_PROJECT_NAME) {
      emails.add(ERRO_EMAIL);
      emails.add(READY_MIX_KHOBAR_DIRECTOR_EMAIL);
    } else if (location === "KUWAIT") {
      emails.add(MUNEER_EMAIL);
      emails.add("mohamed.mahmoud@ahmadiah.com");
    } else if (location === "AVR") {
      emails.add(ERRO_EMAIL);
      emails.add("mohammad.mehieddine@ahmadiah.com");
    } else {
      for (const email of recipientEmailsForUploader(uploaderEmail)) emails.add(normalizeEmail(email));
    }
  }

  const recipients = await tx.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true, email: true } });
  const found = new Set(recipients.map((user) => normalizeEmail(user.email)));
  const missing = [...emails].filter((email) => !found.has(email));
  if (missing.length > 0) throw new Error(`Purchase order recipient account(s) are missing: ${missing.join(", ")}`);
  return [...new Set([...recipients.map((user) => user.id), ...workshopManagers.map((user) => user.id)])];
}

export async function getPurchaseOrderRecipientIds(poId: string) { return resolvePurchaseOrderRecipientIds(prisma, poId); }

export async function canViewPurchaseOrder(user: { userId: string; role: UserRole; email?: string | null }, poId: string) {
  if (isKsaViewer(user)) {
    const linkedKsaMr = await prisma.purchaseOrderMrLink.findFirst({
      where: {
        purchaseOrderId: poId,
        document: { createdBy: { location: { in: [...KSA_USER_LOCATIONS] } } },
      },
      select: { id: true },
    });
    return Boolean(linkedKsaMr);
  }

  if (isReadyMixKhobarDirector(user)) {
    const linkedMrs = await prisma.purchaseOrderMrLink.findMany({
      where: { purchaseOrderId: poId },
      select: { document: { select: { projectName: true } } },
    });
    return linkedMrs.some((link) => link.document.projectName === READY_MIX_KHOBAR_PROJECT_NAME);
  }

  if (isRamziDocumentApprover(user.email)) {
    const linkedAvkMr = await prisma.purchaseOrderMrLink.findFirst({
      where: { purchaseOrderId: poId, document: { createdBy: { location: "AVK" } } },
      select: { id: true },
    });
    return Boolean(linkedAvkMr);
  }

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

  if (isAvkMrViewer({ email: user.email, location: viewer.location, role: user.role })) {
    return linkedMrs.some((link) => link.document.createdBy.location === "AVK");
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

export function canViewPurchaseOrdersSidebar(user: { role: UserRole; email?: string | null }) {
  return isKsaViewer(user)
    || isRamziDocumentApprover(user.email)
    || isReadyMixKhobarDirector(user)
    || user.role === UserRole.CLERK
    || user.role === UserRole.APPROVER_1
    || user.role === UserRole.APPROVER_2
    || user.role === UserRole.APPROVER_3
    || user.role === UserRole.ADMIN;
}
