import Link from "next/link";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import ReceivingVoucherCell from "@/components/receiving-voucher-cell";
import { requireAuth } from "@/lib/auth/guards";
import { getInvoiceScopeForUser, invoiceScopeMatchesMr, invoiceScopeMrWhere } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CashReceivingVouchersPage() {
  const session = await requireAuth();
  const scope = getInvoiceScopeForUser(session);
  if (!scope) redirect("/unauthorized");

  const vouchers = await prisma.cashReceivingVoucher.findMany({
    where: scope.global ? {} : { document: invoiceScopeMrWhere(scope) },
    include: {
      uploadedBy: { select: { name: true } },
      document: {
        select: { id: true, documentNumber: true, title: true, projectName: true, createdBy: { select: { location: true } } },
      },
    },
    orderBy: { uploadedAt: "desc" },
  });

  const visibleVouchers = vouchers.filter(({ document }) => invoiceScopeMatchesMr(scope, {
    location: document.createdBy.location,
    projectName: document.projectName,
  }));

  return (
    <DashboardShell role={session.role} userName={session.name} title="Cash Receiving Vouchers" subtitle={`${scope.label} Cash MR receiving vouchers`}>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Cash Receiving Vouchers</h2>
        </div>
        {visibleVouchers.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No Cash Receiving Vouchers are available for {scope.label} Cash MRs.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Voucher</th>
                  <th className="px-5 py-3 font-semibold">Cash MR</th>
                  <th className="px-5 py-3 font-semibold">Uploaded</th>
                  <th className="px-5 py-3 font-semibold">Uploaded By</th>
                </tr>
              </thead>
              <tbody>
                {visibleVouchers.map((voucher) => (
                  <tr key={voucher.id} className="border-t border-slate-100">
                    <td className="px-5 py-4"><ReceivingVoucherCell voucher={voucher} kind="CASH_RECEIVING_VOUCHER" canDelete={session.role === UserRole.ADMIN} /></td>
                    <td className="px-5 py-4">
                      <Link href={`/documents/${voucher.document.id}`} className="font-medium text-cyan-700 hover:underline">{voucher.document.documentNumber} - {voucher.document.title}</Link>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(voucher.uploadedAt)}</td>
                    <td className="px-5 py-4 text-slate-600">{voucher.uploadedBy.name}</td>
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
