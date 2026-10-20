import { DocumentStatus, UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import PurchaseOrderListTable from "@/components/purchase-order-list-table";
import PurchaseOrderInvoiceUpload from "@/components/purchase-order-invoice-upload";
import PurchaseOrderUpload from "@/components/purchase-order-upload";
import { requireAuth } from "@/lib/auth/guards";
import { canViewPurchaseOrder, canViewPurchaseOrdersSidebar, isGlobalPurchaseOrderViewer, isMuneer, isOmar, isReadyMixKhobarDirector, READY_MIX_KHOBAR_PROJECT_NAME } from "@/lib/po-access";
import { prisma } from "@/lib/prisma";
import { canUploadInvoices, getInvoiceScopeForUser, invoiceScopeMrWhere, resolveInvoiceScopeForMrs } from "@/lib/invoice-access";
import { isKsaViewer, KSA_USER_LOCATIONS } from "@/lib/ksa-viewer";
import { isRamziDocumentApprover } from "@/lib/mohamed-document-workflow";
import { isAvkMrViewer } from "@/lib/avk-access";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const session = await requireAuth();
  if (!canViewPurchaseOrdersSidebar(session)) redirect("/unauthorized");
  const isReadyMixViewer = isReadyMixKhobarDirector(session);
  const isRamziAvkViewer = isRamziDocumentApprover(session.email);
  const isKsaReadOnlyViewer = isKsaViewer(session);
  const invoiceScope = isKsaReadOnlyViewer ? null : getInvoiceScopeForUser(session);
  const resolvedSearchParams = await searchParams;
  const viewer = await prisma.user.findUnique({ where: { id: session.userId }, select: { location: true } });
  const isAvkDataViewer = isAvkMrViewer({ email: session.email, location: viewer?.location, role: session.role });
  const requestedLocation = resolvedSearchParams.location === "AVR" || resolvedSearchParams.location === "AVK" || resolvedSearchParams.location === "KUWAIT" ? resolvedSearchParams.location : "";
  const locationFilter = isKsaReadOnlyViewer ? "" : isRamziAvkViewer || (isAvkDataViewer && !isGlobalPurchaseOrderViewer(session)) ? "AVK" : isGlobalPurchaseOrderViewer(session) ? requestedLocation : viewer?.location ?? "";

  const [approvedMrs, purchaseOrders] = await Promise.all([
    prisma.document.findMany({
    where: {
      documentType: "MATERIAL_REQUISITION",
      status: DocumentStatus.APPROVED,
      ...(isReadyMixViewer
        ? { projectName: READY_MIX_KHOBAR_PROJECT_NAME }
        : isKsaReadOnlyViewer
          ? { createdBy: { location: { in: [...KSA_USER_LOCATIONS] } } }
        : isOmar(session) && locationFilter ? { createdBy: { location: locationFilter } } : {}),
    },
    select: {
      id: true,
      documentNumber: true,
      title: true,
      mrNumber: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { originalName: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    }),
    prisma.purchaseOrder.findMany({
      orderBy: { uploadedAt: "desc" },
      include: {
        uploadedBy: { select: { name: true } },
        receivedBy: { select: { name: true, email: true } },
        _count: { select: { invoices: true } },
        mrLinks: { include: { document: { select: { id: true, documentNumber: true, title: true, projectName: true, createdBy: { select: { location: true } } } } } },
      },
    }),
  ]);

  const visiblePurchaseOrders = (await Promise.all(
    purchaseOrders.map(async (purchaseOrder) => ({
      purchaseOrder,
      visible: (isKsaReadOnlyViewer
        ? purchaseOrder.mrLinks.some((link) => KSA_USER_LOCATIONS.includes(link.document.createdBy.location as typeof KSA_USER_LOCATIONS[number]))
        : locationFilter ? purchaseOrder.mrLinks.some((link) => link.document.createdBy.location === locationFilter) : true)
        && await canViewPurchaseOrder(session, purchaseOrder.id),
    })),
  )).filter((item) => item.visible).map((item) => item.purchaseOrder);

  const invoiceUploadPurchaseOrders = invoiceScope && canUploadInvoices(session, invoiceScope)
    ? visiblePurchaseOrders
        .filter((purchaseOrder) => resolveInvoiceScopeForMrs(purchaseOrder.mrLinks.map((link) => ({
          location: link.document.createdBy.location,
          projectName: link.document.projectName,
        })))?.key === invoiceScope.key)
        .map((purchaseOrder) => ({
          id: purchaseOrder.id,
          poNumber: purchaseOrder.poNumber,
          relatedMrLabels: purchaseOrder.mrLinks.map((link) => link.document.documentNumber),
        }))
    : [];
  const invoiceUploadCashMrs = invoiceScope && canUploadInvoices(session, invoiceScope)
    ? await prisma.document.findMany({
        where: {
          documentType: "MATERIAL_REQUISITION",
          mrType: "CASH",
          status: DocumentStatus.APPROVED,
          ...invoiceScopeMrWhere(invoiceScope),
        },
        select: { id: true, documentNumber: true, title: true },
        orderBy: { updatedAt: "desc" },
      })
    : [];

  const canAdminDelete = session.role === UserRole.ADMIN;
  const canRequestDeletion = session.role === UserRole.ADMIN || isOmar(session);

  return (
    <DashboardShell role={session.role} userName={session.name} title="Purchase Orders" subtitle="Upload POs and link them to approved MRs">
      {isOmar(session) ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Create Purchase Orders</h2>
          <p className="mt-1 text-sm text-slate-600">Purchase Order is selected by default. Choose a description and related approved MR for each file.</p>
          <div className="mt-5">
            <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium text-slate-700">MR location<select name="location" defaultValue={locationFilter} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">All locations</option><option value="KUWAIT">Kuwait</option><option value="AVR">AVR</option><option value="AVK">AVK</option></select></label>
              <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">Filter</button>
            </form>
            <PurchaseOrderUpload location={locationFilter || undefined} approvedMrs={approvedMrs.map((mr) => ({
            id: mr.id,
            documentNumber: mr.documentNumber,
            title: mr.title,
            mrNumber: mr.mrNumber,
            fileName: mr.versions[0]?.originalName,
          }))} />
          </div>
        </section>
      ) : null}
      {invoiceScope && canUploadInvoices(session, invoiceScope) ? (
        <PurchaseOrderInvoiceUpload
          purchaseOrders={invoiceUploadPurchaseOrders}
          cashMrs={invoiceUploadCashMrs}
        />
      ) : null}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold text-slate-900">Purchase Orders</h2>{!isGlobalPurchaseOrderViewer(session) ? null : <form method="get" className="flex items-end gap-2"><label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Location<select name="location" defaultValue={locationFilter} className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal"><option value="">All</option><option value="KUWAIT">Kuwait</option><option value="AVR">AVR</option><option value="AVK">AVK</option></select></label><button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">Apply</button></form>}</div></div>
        {visiblePurchaseOrders.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No purchase orders available.</p>
        ) : (
          <PurchaseOrderListTable
            purchaseOrders={visiblePurchaseOrders.map((po) => ({
              id: po.id,
              poNumber: po.poNumber,
              originalName: po.originalName,
              description: po.description,
              uploadedAt: po.uploadedAt.toISOString(),
              uploadedByName: po.uploadedBy.name,
              receivedAt: po.receivedAt?.toISOString() ?? null,
              receivedByName: po.receivedBy?.name ?? null,
              receivedByEmail: po.receivedBy?.email ?? null,
              invoiceCount: po._count.invoices,
              linkedMrs: po.mrLinks
                .filter((link) => isKsaReadOnlyViewer
                  ? KSA_USER_LOCATIONS.includes(link.document.createdBy.location as typeof KSA_USER_LOCATIONS[number])
                  : !isReadyMixViewer || link.document.projectName === READY_MIX_KHOBAR_PROJECT_NAME)
                .map((link) => ({
                id: link.document.id,
                documentNumber: link.document.documentNumber,
                title: link.document.title,
              })),
            }))}
            canMarkReceived={!isKsaReadOnlyViewer && isMuneer(session)}
            canAdminDelete={canAdminDelete}
            canRequestDeletion={canRequestDeletion}
          />
        )}
      </section>
    </DashboardShell>
  );
}
