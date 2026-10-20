import Link from "next/link";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import InvoiceDeleteButton from "@/components/invoice-delete-button";
import { requireAuth } from "@/lib/auth/guards";
import { getInvoiceScopeForUser, invoiceScopeMatchesMr, invoiceScopeMrWhere, resolveInvoiceScopeForMrs } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const session = await requireAuth();
  const scope = getInvoiceScopeForUser(session);
  if (!scope) redirect("/unauthorized");

  const invoices = await prisma.purchaseOrderInvoice.findMany({
    where: scope.global ? {} : {
      OR: [
        { purchaseOrder: { mrLinks: { some: { document: invoiceScopeMrWhere(scope) } } } },
        { document: invoiceScopeMrWhere(scope) },
      ],
    },
    include: {
      uploadedBy: { select: { name: true } },
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          mrLinks: {
            select: {
              document: {
                select: {
                  id: true,
                  documentNumber: true,
                  title: true,
                  projectName: true,
                  createdBy: { select: { location: true } },
                },
              },
            },
          },
        },
      },
      document: {
        select: {
          id: true,
          documentNumber: true,
          title: true,
          projectName: true,
          mrType: true,
          createdBy: { select: { location: true } },
        },
      },
    },
    orderBy: { uploadedAt: "desc" },
  });

  const visibleInvoices = invoices.filter((invoice) => {
    if (scope.global) return true;
    if (invoice.document) {
      return invoiceScopeMatchesMr(scope, {
        location: invoice.document.createdBy.location,
        projectName: invoice.document.projectName,
      });
    }
    const mrs = invoice.purchaseOrder?.mrLinks.map((link) => ({
      location: link.document.createdBy.location,
      projectName: link.document.projectName,
    })) ?? [];
    return resolveInvoiceScopeForMrs(mrs)?.key === scope.key;
  });

  return (
    <DashboardShell role={session.role} userName={session.name} title="Invoices" subtitle={`${scope.label} purchase order invoices`}>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Invoices</h2>
        </div>
        {visibleInvoices.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No invoices are available for {scope.label} purchase orders.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Invoice</th>
                  <th className="px-5 py-3 font-semibold">Linked To</th>
                  <th className="px-5 py-3 font-semibold">Related MR</th>
                  <th className="px-5 py-3 font-semibold">Uploaded</th>
                  <th className="px-5 py-3 font-semibold">Uploaded By</th>
                  <th className="px-5 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleInvoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t border-slate-100">
                    <td className="px-5 py-4 font-medium text-slate-900">{invoice.originalName}</td>
                    <td className="px-5 py-4">
                      {invoice.purchaseOrder ? (
                        <Link href={`/purchase-orders/${invoice.purchaseOrder.id}`} className="font-medium text-cyan-700 hover:underline">PO {invoice.purchaseOrder.poNumber}</Link>
                      ) : invoice.document ? (
                        <Link href={`/documents/${invoice.document.id}`} className="font-medium text-cyan-700 hover:underline">Cash MR {invoice.document.documentNumber}</Link>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-1">
                        {invoice.purchaseOrder?.mrLinks.map(({ document }) => (
                          <Link key={document.id} href={`/documents/${document.id}`} className="font-medium text-cyan-700 hover:underline">{document.documentNumber} - {document.title}</Link>
                        ))}
                        {invoice.document ? <Link href={`/documents/${invoice.document.id}`} className="font-medium text-cyan-700 hover:underline">{invoice.document.documentNumber} - {invoice.document.title}</Link> : null}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(invoice.uploadedAt)}</td>
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
    </DashboardShell>
  );
}