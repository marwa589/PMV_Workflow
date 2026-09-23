import { DocumentStatus, UserRole } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import PurchaseOrderListTable from "@/components/purchase-order-list-table";
import PurchaseOrderUpload from "@/components/purchase-order-upload";
import { requireAuth } from "@/lib/auth/guards";
import { isOmar } from "@/lib/po-access";
import { canViewPurchaseOrder, canViewPurchaseOrdersSidebar } from "@/lib/po-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  const session = await requireAuth();
  if (!canViewPurchaseOrdersSidebar(session.role)) redirect("/unauthorized");

  const [approvedMrs, purchaseOrders] = await Promise.all([
    prisma.document.findMany({
    where: { documentType: "MATERIAL_REQUISITION", status: DocumentStatus.APPROVED },
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
        mrLinks: { include: { document: { select: { id: true, documentNumber: true } } } },
      },
    }),
  ]);

  const visiblePurchaseOrders = (await Promise.all(
    purchaseOrders.map(async (purchaseOrder) => ({
      purchaseOrder,
      visible: await canViewPurchaseOrder(session, purchaseOrder.id),
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
          <div className="mt-5"><PurchaseOrderUpload approvedMrs={approvedMrs.map((mr) => ({
            id: mr.id,
            documentNumber: mr.documentNumber,
            title: mr.title,
            mrNumber: mr.mrNumber,
            fileName: mr.versions[0]?.originalName,
          }))} /></div>
        </section>
      ) : null}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold text-slate-900">Purchase Orders</h2></div>
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
            }))}
            canAdminDelete={canAdminDelete}
            canRequestDeletion={canRequestDeletion}
          />
        )}
      </section>
    </DashboardShell>
  );
}
