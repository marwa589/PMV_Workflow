import { DocumentStatus, UserRole } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import PurchaseOrderListTable from "@/components/purchase-order-list-table";
import PurchaseOrderUpload from "@/components/purchase-order-upload";
import { requireAuth } from "@/lib/auth/guards";
import { isGlobalPurchaseOrderViewer, isMuneer, isOmar } from "@/lib/po-access";
import { canViewPurchaseOrder, canViewPurchaseOrdersSidebar } from "@/lib/po-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const session = await requireAuth();
  if (!canViewPurchaseOrdersSidebar(session.role)) redirect("/unauthorized");
  const resolvedSearchParams = await searchParams;
  const viewer = await prisma.user.findUnique({ where: { id: session.userId }, select: { location: true } });
  const requestedLocation = resolvedSearchParams.location === "AVR" || resolvedSearchParams.location === "AVK" || resolvedSearchParams.location === "KUWAIT" ? resolvedSearchParams.location : "";
  const locationFilter = isGlobalPurchaseOrderViewer(session) ? requestedLocation : viewer?.location ?? "";

  const [approvedMrs, purchaseOrders] = await Promise.all([
    prisma.document.findMany({
    where: {
      documentType: "MATERIAL_REQUISITION",
      status: DocumentStatus.APPROVED,
      ...(isOmar(session) && locationFilter ? { createdBy: { location: locationFilter } } : {}),
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
        mrLinks: { include: { document: { select: { id: true, documentNumber: true, title: true, createdBy: { select: { location: true } } } } } },
      },
    }),
  ]);

  const visiblePurchaseOrders = (await Promise.all(
    purchaseOrders.map(async (purchaseOrder) => ({
      purchaseOrder,
      visible: (locationFilter ? purchaseOrder.mrLinks.some((link) => link.document.createdBy.location === locationFilter) : true)
        && await canViewPurchaseOrder(session, purchaseOrder.id),
    })),
  )).filter((item) => item.visible).map((item) => item.purchaseOrder);

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
              linkedMrs: po.mrLinks.map((link) => ({
                id: link.document.id,
                documentNumber: link.document.documentNumber,
                title: link.document.title,
              })),
            }))}
            canMarkReceived={isMuneer(session)}
            canAdminDelete={canAdminDelete}
            canRequestDeletion={canRequestDeletion}
          />
        )}
      </section>
    </DashboardShell>
  );
}
