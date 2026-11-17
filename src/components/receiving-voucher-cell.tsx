import InvoiceDeleteButton from "@/components/invoice-delete-button";

type LinkedVoucher = { id: string; originalName: string } | null | undefined;

/** Table cell content for a linked GRV or Cash Receiving Voucher: file name, download link and admin delete. */
export default function ReceivingVoucherCell({
  voucher,
  kind,
  canDelete = false,
}: {
  voucher: LinkedVoucher;
  kind: "GRV" | "CASH_RECEIVING_VOUCHER";
  canDelete?: boolean;
}) {
  if (!voucher) return <span className="text-slate-400">Not uploaded</span>;

  const basePath = kind === "GRV" ? `/api/grvs/${voucher.id}` : `/api/cash-receiving-vouchers/${voucher.id}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-slate-900">{voucher.originalName}</span>
      <div className="flex items-center gap-3">
        <a href={`${basePath}/download`} className="font-medium text-cyan-700 hover:underline">Download</a>
        {canDelete ? (
          <InvoiceDeleteButton
            invoiceId={voucher.id}
            endpoint={basePath}
            confirmText={kind === "GRV" ? "Delete this GRV and remove its stored file?" : "Delete this Cash Receiving Voucher and remove its stored file?"}
          />
        ) : null}
      </div>
    </div>
  );
}
