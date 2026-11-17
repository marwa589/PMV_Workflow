import "server-only";

import { DocumentStatus, UserRole } from "@prisma/client";
import { canUploadInvoices, getInvoiceScopeForUser, invoiceScopeMatchesMr, invoiceScopeMrWhere, resolveInvoiceScopeForMrs } from "@/lib/invoice-access";
import { canViewPurchaseOrder } from "@/lib/po-access";
import { prisma } from "@/lib/prisma";
import { mrMatchNames, purchaseOrderMatchNames, referenceNames } from "@/lib/receiving-link-match";

/** `originalName` is the PO file name (it carries the LPO number used to auto-link invoice files). */
export type InvoiceUploadPurchaseOrder = { id: string; poNumber: string; originalName: string; relatedMrLabels: string[] };
export type InvoiceUploadCashMr = { id: string; documentNumber: string; title: string; mrNumber: string | null };
/** `matchNames`: the invoice's INV / LPO / MR references, used to auto-link GRV files. */
export type GrvUploadInvoice = { id: string; label: string; matchNames: string[] };

export type ReceivingUploadOptions = {
  /** POs an invoice can be attached to. */
  purchaseOrders: InvoiceUploadPurchaseOrder[];
  /** Approved Cash MRs an invoice can be attached to. */
  cashMrs: InvoiceUploadCashMr[];
  /** Invoices that do not have a GRV yet. */
  grvInvoices: GrvUploadInvoice[];
  /** Approved Cash MRs that do not have a Cash Receiving Voucher yet. */
  voucherCashMrs: InvoiceUploadCashMr[];
};

type UploadUser = { userId: string; role: UserRole; email?: string | null };

/**
 * Upload choices for invoices, GRVs and Cash Receiving Vouchers, or null when the user is not an uploader.
 * Pass `purchaseOrders` to reuse a PO list the caller already filtered (the Purchase Orders page does).
 */
export async function getReceivingUploadOptions(
  user: UploadUser,
  options: { purchaseOrders?: InvoiceUploadPurchaseOrder[] } = {},
): Promise<ReceivingUploadOptions | null> {
  if (user.role === UserRole.KSA_VIEWER) return null;
  const scope = getInvoiceScopeForUser(user);
  if (!scope || !canUploadInvoices(user, scope)) return null;

  const mrInScope = invoiceScopeMrWhere(scope);
  const approvedCashMrWhere = {
    documentType: "MATERIAL_REQUISITION" as const,
    mrType: "CASH" as const,
    status: DocumentStatus.APPROVED,
    ...mrInScope,
  };

  const [purchaseOrders, cashMrs, voucherCashMrs, invoices] = await Promise.all([
    options.purchaseOrders ? Promise.resolve(options.purchaseOrders) : loadPurchaseOrders(user, scope),
    prisma.document.findMany({
      where: approvedCashMrWhere,
      select: { id: true, documentNumber: true, title: true, mrNumber: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.document.findMany({
      where: { ...approvedCashMrWhere, cashReceivingVoucher: { is: null } },
      select: { id: true, documentNumber: true, title: true, mrNumber: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.purchaseOrderInvoice.findMany({
      where: {
        goodsReceivingVoucher: { is: null },
        OR: [
          { purchaseOrder: { mrLinks: { some: { document: mrInScope } } } },
          { document: mrInScope },
        ],
      },
      select: {
        id: true,
        originalName: true,
        purchaseOrder: {
          select: {
            poNumber: true,
            originalName: true,
            mrLinks: { select: { document: { select: { projectName: true, createdBy: { select: { location: true } } } } } },
          },
        },
        document: { select: { documentNumber: true, mrNumber: true, projectName: true, createdBy: { select: { location: true } } } },
      },
      orderBy: { uploadedAt: "desc" },
    }),
  ]);

  const grvInvoices = invoices
    .filter((invoice) => {
      if (invoice.document) {
        return invoiceScopeMatchesMr(scope, { location: invoice.document.createdBy.location, projectName: invoice.document.projectName });
      }
      const mrs = invoice.purchaseOrder?.mrLinks.map((link) => ({
        location: link.document.createdBy.location,
        projectName: link.document.projectName,
      })) ?? [];
      return resolveInvoiceScopeForMrs(mrs)?.key === scope.key;
    })
    .map((invoice) => ({
      id: invoice.id,
      label: invoice.purchaseOrder
        ? `${invoice.originalName} | PO ${invoice.purchaseOrder.poNumber}`
        : `${invoice.originalName} | Cash MR ${invoice.document?.documentNumber ?? ""}`,
      matchNames: [...new Set([
        ...referenceNames(invoice.originalName, ["INV", "PO", "MR"]),
        ...(invoice.purchaseOrder ? purchaseOrderMatchNames(invoice.purchaseOrder) : []),
        ...(invoice.document ? mrMatchNames(invoice.document) : []),
      ])],
    }));

  return { purchaseOrders, cashMrs, grvInvoices, voucherCashMrs };
}

async function loadPurchaseOrders(
  user: UploadUser,
  scope: NonNullable<ReturnType<typeof getInvoiceScopeForUser>>,
): Promise<InvoiceUploadPurchaseOrder[]> {
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where: { mrLinks: { some: { document: invoiceScopeMrWhere(scope) } } },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      poNumber: true,
      originalName: true,
      mrLinks: { select: { document: { select: { documentNumber: true, projectName: true, createdBy: { select: { location: true } } } } } },
    },
  });

  const visible = await Promise.all(purchaseOrders.map(async (purchaseOrder) => ({
    purchaseOrder,
    visible: resolveInvoiceScopeForMrs(purchaseOrder.mrLinks.map((link) => ({
      location: link.document.createdBy.location,
      projectName: link.document.projectName,
    })))?.key === scope.key && await canViewPurchaseOrder(user, purchaseOrder.id),
  })));

  return visible
    .filter((item) => item.visible)
    .map(({ purchaseOrder }) => ({
      id: purchaseOrder.id,
      poNumber: purchaseOrder.poNumber,
      originalName: purchaseOrder.originalName,
      relatedMrLabels: purchaseOrder.mrLinks.map((link) => link.document.documentNumber),
    }));
}
