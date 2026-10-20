import Link from "next/link";
import { UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, FileText } from "lucide-react";
import DashboardShell from "@/components/dashboard-shell";
import PurchaseOrderDeleteButton from "@/components/purchase-order-delete-button";
import InvoiceDeleteButton from "@/components/invoice-delete-button";
import { requireAuth } from "@/lib/auth/guards";
import { canViewPurchaseOrder, isReadyMixKhobarDirector, READY_MIX_KHOBAR_PROJECT_NAME } from "@/lib/po-access";
import { canViewInvoicesForPurchaseOrder } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";
import { isKsaViewer, KSA_USER_LOCATIONS } from "@/lib/ksa-viewer";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function PurchaseOrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  if (!(await canViewPurchaseOrder(session, id))) redirect("/unauthorized");
  const isReadyMixViewer = isReadyMixKhobarDirector(session);

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      uploadedBy: { select: { name: true } },
      mrLinks: {
        orderBy: { createdAt: "asc" },
        include: { document: { select: { id: true, documentNumber: true, title: true, status: true, projectName: true, createdBy: { select: { location: true } } } } },
      },
      invoices: {
        orderBy: { uploadedAt: "desc" },
        include: { uploadedBy: { select: { name: true } } },
      },
    },
  });
  if (!po) notFound();
  const canViewInvoices = !isKsaViewer(session) && await canViewInvoicesForPurchaseOrder(session, po.id);
  const visibleMrLinks = isKsaViewer(session)
    ? po.mrLinks.filter((link) => KSA_USER_LOCATIONS.includes(link.document.createdBy.location as typeof KSA_USER_LOCATIONS[number]))
    : isReadyMixViewer
      ? po.mrLinks.filter((link) => link.document.projectName === READY_MIX_KHOBAR_PROJECT_NAME)
      : po.mrLinks;

  return (
    <DashboardShell role={session.role} userName={session.name} title="Purchase Order" subtitle="Linked material requisitions">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/purchase-orders" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back to Purchase Orders
        </Link>
        <a href={`/api/purchase-orders/${po.id}/download`} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Download className="h-4 w-4" />
          Download current file
        </a>
        <a href={`/api/purchase-orders/${po.id}/download?inline=1`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100">
          <FileText className="h-4 w-4" />
          Open File
        </a>
        {!isReadyMixViewer && !isKsaViewer(session) ? <PurchaseOrderDeleteButton purchaseOrderId={po.id} /> : null}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Document overview</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{po.poNumber}</h2>
            <p className="mt-2 text-sm text-slate-600">{po.originalName}</p>
          </div>
          <div className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">PO</div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-500">Document type</span><span className="font-semibold text-slate-900">PO</span></div>
              <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-500">PO number</span><span className="font-semibold text-slate-900">{po.poNumber}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-500">Filename</span><span className="font-semibold text-slate-900">{po.originalName}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-500">Description</span><span className="font-semibold text-slate-900">{po.description || "—"}</span></div>
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-500">Submitted by</span><span className="font-semibold text-slate-900">{po.uploadedBy.name}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-500">Created at</span><span className="font-semibold text-slate-900">{formatDate(po.uploadedAt)}</span></div>
              <div className="flex items-center justify-between gap-3"><span className="font-medium text-slate-500">Related MRs</span><span className="font-semibold text-slate-900">{visibleMrLinks.length}</span></div>
            </div>
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4"><h3 className="text-base font-semibold text-slate-900">Linked MRs</h3></div>
        {visibleMrLinks.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">No MRs linked.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">MR Number</th><th className="px-5 py-3 font-semibold">MR Status</th><th className="px-5 py-3 font-semibold">View Details</th></tr></thead><tbody>
            {visibleMrLinks.map(({ document }) => <tr key={document.id} className="border-t border-slate-100"><td className="px-5 py-4"><Link href={`/documents/${document.id}`} className="font-medium text-cyan-700 hover:underline">{document.documentNumber} - {document.title}</Link></td><td className="px-5 py-4 text-slate-600">{document.status.replaceAll("_", " ")}</td><td className="px-5 py-4"><Link href={`/documents/${document.id}`} className="font-medium text-cyan-700 hover:underline">View Details</Link></td></tr>)}
          </tbody></table></div>
        )}
      </section>
      {canViewInvoices ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Invoices</h3>
          </div>
          {po.invoices.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No invoices have been uploaded for this PO.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-5 py-3 font-semibold">Invoice</th><th className="px-5 py-3 font-semibold">Uploaded</th><th className="px-5 py-3 font-semibold">Uploaded By</th><th className="px-5 py-3 font-semibold">Action</th></tr>
                </thead>
                <tbody>
                  {po.invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-t border-slate-100">
                      <td className="px-5 py-4 font-medium text-slate-900">{invoice.originalName}</td>
                      <td className="px-5 py-4 text-slate-600">{formatDate(invoice.uploadedAt)}</td>
                      <td className="px-5 py-4 text-slate-600">{invoice.uploadedBy.name}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <a href={`/api/invoices/${invoice.id}/download`} className="font-medium text-cyan-700 hover:underline">Download</a>
                            {session.role === UserRole.ADMIN ? <InvoiceDeleteButton invoiceId={invoice.id} /> : null}
                          </div>
                        </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </DashboardShell>
  );
}
