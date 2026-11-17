import Link from "next/link";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import ReceivingVoucherCell from "@/components/receiving-voucher-cell";
import { requireAuth } from "@/lib/auth/guards";
import { getInvoiceScopeForUser, invoiceScopeMatchesMr, invoiceScopeMrWhere, resolveInvoiceScopeForMrs } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function GrvsPage() {
  const session = await requireAuth();
  const scope = getInvoiceScopeForUser(session);
  if (!scope) redirect("/unauthorized");

  const grvs = await prisma.goodsReceivingVoucher.findMany({
    where: scope.global ? {} : {
      invoice: {
        OR: [
          { purchaseOrder: { mrLinks: { some: { document: invoiceScopeMrWhere(scope) } } } },
          { document: invoiceScopeMrWhere(scope) },
        ],
      },
    },
    include: {
      uploadedBy: { select: { name: true } },
      invoice: {
        select: {
          id: true,
          originalName: true,
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              mrLinks: { select: { document: { select: { projectName: true, createdBy: { select: { location: true } } } } } },
            },
          },
          document: {
            select: { id: true, documentNumber: true, projectName: true, createdBy: { select: { location: true } } },
          },
        },
      },
    },
    orderBy: { uploadedAt: "desc" },
  });

  const visibleGrvs = grvs.filter(({ invoice }) => {
    if (scope.global) return true;
    if (invoice.document) {
      return invoiceScopeMatchesMr(scope, { location: invoice.document.createdBy.location, projectName: invoice.document.projectName });
    }
    const mrs = invoice.purchaseOrder?.mrLinks.map((link) => ({
      location: link.document.createdBy.location,
      projectName: link.document.projectName,
    })) ?? [];
    return resolveInvoiceScopeForMrs(mrs)?.key === scope.key;
  });

  return (
    <DashboardShell role={session.role} userName={session.name} title="GRVs" subtitle={`${scope.label} goods receiving vouchers`}>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Goods Receiving Vouchers</h2>
        </div>
        {visibleGrvs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No GRVs are available for {scope.label} invoices.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">GRV</th>
                  <th className="px-5 py-3 font-semibold">Invoice</th>
                  <th className="px-5 py-3 font-semibold">Linked To</th>
                  <th className="px-5 py-3 font-semibold">Uploaded</th>
                  <th className="px-5 py-3 font-semibold">Uploaded By</th>
                </tr>
              </thead>
              <tbody>
                {visibleGrvs.map((grv) => (
                  <tr key={grv.id} className="border-t border-slate-100">
                    <td className="px-5 py-4"><ReceivingVoucherCell voucher={grv} kind="GRV" canDelete={session.role === UserRole.ADMIN} /></td>
                    <td className="px-5 py-4">
                      <a href={`/api/invoices/${grv.invoice.id}/download`} className="font-medium text-cyan-700 hover:underline">{grv.invoice.originalName}</a>
                    </td>
                    <td className="px-5 py-4">
                      {grv.invoice.purchaseOrder ? (
                        <Link href={`/purchase-orders/${grv.invoice.purchaseOrder.id}`} className="font-medium text-cyan-700 hover:underline">PO {grv.invoice.purchaseOrder.poNumber}</Link>
                      ) : grv.invoice.document ? (
                        <Link href={`/documents/${grv.invoice.document.id}`} className="font-medium text-cyan-700 hover:underline">Cash MR {grv.invoice.document.documentNumber}</Link>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(grv.uploadedAt)}</td>
                    <td className="px-5 py-4 text-slate-600">{grv.uploadedBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
