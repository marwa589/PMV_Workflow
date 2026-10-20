import "server-only";

import { Prisma, UserLocation, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { USER_LOCATION_ASSIGNMENTS } from "@/lib/workflow-locations";

type InvoiceUser = { email?: string | null; role?: UserRole };

export type InvoiceScopePolicy = {
  key: string;
  label: string;
  mrLocations: readonly UserLocation[];
  projectNames: readonly string[];
  uploaderEmails: readonly string[];
  viewerEmails: readonly string[];
  global?: boolean;
};

export const INVOICE_SCOPE_POLICIES: readonly InvoiceScopePolicy[] = [
  {
    key: "KUWAIT",
    label: "Kuwait",
    mrLocations: [UserLocation.KUWAIT],
    projectNames: [],
    uploaderEmails: ["mohamed.mahmoud@ahmadiah.com", "muneer.kottappuram@ahmadiah.com"],
    viewerEmails: [
      ...USER_LOCATION_ASSIGNMENTS.KUWAIT,
      "muneer.kottappuram@ahmadiah.com",
      "george.azzi@ahmadiah.com",
      "marc.baddour@ahmadiah.com",
    ],
  },
];

function normalizeEmail(email?: string | null): string {
  return email?.trim().toLowerCase() ?? "";
}

export function getInvoiceScopeForUser(user: InvoiceUser): InvoiceScopePolicy | null {
  if (user.role === UserRole.KSA_VIEWER) return null;

  if (user.role === UserRole.ADMIN) {
    return {
      key: "ALL",
      label: "All",
      mrLocations: [],
      projectNames: [],
      uploaderEmails: [],
      viewerEmails: [],
      global: true,
    };
  }

  if (user.role === UserRole.APPROVER_2 || user.role === UserRole.APPROVER_3) {
    return INVOICE_SCOPE_POLICIES[0];
  }

  const email = normalizeEmail(user.email);
  return INVOICE_SCOPE_POLICIES.find((scope) => scope.viewerEmails.includes(email)) ?? null;
}

export function canViewInvoices(user: InvoiceUser): boolean {
  return getInvoiceScopeForUser(user) !== null;
}

export function canUploadInvoices(user: InvoiceUser, scope: InvoiceScopePolicy): boolean {
  return scope.uploaderEmails.includes(normalizeEmail(user.email));
}

export function canViewKuwaitInvoices(user: InvoiceUser): boolean {
  return user.role === UserRole.APPROVER_2
    || user.role === UserRole.APPROVER_3
    || INVOICE_SCOPE_POLICIES[0].viewerEmails.includes(normalizeEmail(user.email));
}

export type InvoiceMrScope = {
  location?: UserLocation | null;
  projectName?: string | null;
};

export function invoiceScopeMatchesMr(scope: InvoiceScopePolicy, mr: InvoiceMrScope): boolean {
  if (scope.global) return true;
  return Boolean(
    (mr.location && scope.mrLocations.includes(mr.location))
    || (mr.projectName && scope.projectNames.includes(mr.projectName)),
  );
}

export function invoiceScopeMrWhere(scope: InvoiceScopePolicy): Prisma.DocumentWhereInput {
  if (scope.global) return {};
  const conditions: Prisma.DocumentWhereInput[] = [];
  if (scope.mrLocations.length > 0) conditions.push({ createdBy: { location: { in: [...scope.mrLocations] } } });
  if (scope.projectNames.length > 0) conditions.push({ projectName: { in: [...scope.projectNames] } });
  return { OR: conditions };
}

export function resolveInvoiceScopeForMrs(mrs: InvoiceMrScope[]): InvoiceScopePolicy | null {
  if (mrs.length === 0) return null;
  return INVOICE_SCOPE_POLICIES.find((scope) => mrs.every((mr) => invoiceScopeMatchesMr(scope, mr))) ?? null;
}

export async function getInvoiceScopeForPurchaseOrder(purchaseOrderId: string): Promise<InvoiceScopePolicy | null> {
  const links = await prisma.purchaseOrderMrLink.findMany({
    where: { purchaseOrderId },
    select: { document: { select: { projectName: true, createdBy: { select: { location: true } } } } },
  });

  return resolveInvoiceScopeForMrs(links.map((link) => ({
    location: link.document.createdBy.location,
    projectName: link.document.projectName,
  })));
}

export async function canViewInvoicesForPurchaseOrder(user: InvoiceUser, purchaseOrderId: string): Promise<boolean> {
  const [viewerScope, purchaseOrderScope] = await Promise.all([
    Promise.resolve(getInvoiceScopeForUser(user)),
    getInvoiceScopeForPurchaseOrder(purchaseOrderId),
  ]);

  return Boolean(viewerScope && (viewerScope.global || (purchaseOrderScope && viewerScope.key === purchaseOrderScope.key)));
}

export async function canUploadInvoicesForPurchaseOrder(user: InvoiceUser, purchaseOrderId: string): Promise<boolean> {
  const purchaseOrderScope = await getInvoiceScopeForPurchaseOrder(purchaseOrderId);
  return Boolean(
    purchaseOrderScope
    && getInvoiceScopeForUser(user)?.key === purchaseOrderScope.key
    && canUploadInvoices(user, purchaseOrderScope),
  );
}

export async function getInvoiceScopeForMr(documentId: string): Promise<InvoiceScopePolicy | null> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      documentType: true,
      mrType: true,
      status: true,
      createdBy: { select: { location: true } },
      projectName: true,
    },
  });
  if (!document || document.documentType !== "MATERIAL_REQUISITION" || document.mrType !== "CASH" || document.status !== "APPROVED") return null;
  return resolveInvoiceScopeForMrs([{ location: document.createdBy.location, projectName: document.projectName }]);
}

export async function canViewInvoicesForMr(user: InvoiceUser, documentId: string): Promise<boolean> {
  const [viewerScope, mrScope] = await Promise.all([
    Promise.resolve(getInvoiceScopeForUser(user)),
    getInvoiceScopeForMr(documentId),
  ]);
  return Boolean(viewerScope && mrScope && (viewerScope.global || viewerScope.key === mrScope.key));
}

export async function canUploadInvoicesForMr(user: InvoiceUser, documentId: string): Promise<boolean> {
  const mrScope = await getInvoiceScopeForMr(documentId);
  return Boolean(
    mrScope
    && getInvoiceScopeForUser(user)?.key === mrScope.key
    && canUploadInvoices(user, mrScope),
  );
}