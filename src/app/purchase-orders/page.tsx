import { DocumentStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
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
    select: { id: true, documentNumber: true, title: true, mrNumber: true },
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

  return (
    <DashboardShell role={session.role} userName={session.name} title="Purchase Orders" subtitle="Upload POs and link them to approved MRs">
      {isOmar(session) ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Create Purchase Orders</h2>
          <p className="mt-1 text-sm text-slate-600">Purchase Order is selected by default. Choose a description and related approved MR for each file.</p>
          <div className="mt-5"><PurchaseOrderUpload approvedMrs={approvedMrs} /></div>
        </section>
      ) : null}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold text-slate-900">Purchase Orders</h2></div>
        {visiblePurchaseOrders.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">No purchase orders available.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">PO Number</th><th className="px-5 py-3 font-semibold">Filename</th><th className="px-5 py-3 font-semibold">Description</th><th className="px-5 py-3 font-semibold">Uploaded</th><th className="px-5 py-3 font-semibold">Uploaded By</th><th className="px-5 py-3 font-semibold">Linked MRs</th><th className="px-5 py-3 font-semibold">Open File</th></tr></thead><tbody>
            {visiblePurchaseOrders.map((po) => <tr key={po.id} className="border-t border-slate-100"><td className="px-5 py-4"><a href={`/purchase-orders/${po.id}`} className="font-medium text-cyan-700 hover:underline">{po.poNumber}</a></td><td className="px-5 py-4 text-slate-700">{po.originalName}</td><td className="px-5 py-4 text-slate-600">{po.description || "—"}</td><td className="px-5 py-4 text-slate-600">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(po.uploadedAt)}</td><td className="px-5 py-4 text-slate-600">{po.uploadedBy.name}</td><td className="px-5 py-4 text-slate-600">{po.mrLinks.map((link) => link.document.documentNumber).join(", ") || "—"}</td><td className="px-5 py-4"><a href={`/api/purchase-orders/${po.id}/download?inline=1`} target="_blank" rel="noopener noreferrer" className="font-medium text-cyan-700 hover:underline">Open File</a></td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </DashboardShell>
  );
}
