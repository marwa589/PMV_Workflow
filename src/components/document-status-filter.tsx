import { DocumentStatus } from "@prisma/client";
import { DOCUMENT_STATUS_FILTER_OPTIONS, DownloadStatusFilter, ErrStatusFilter, ErrTypeFilter, MrTypeFilter, PoStatusFilter, ERR_STATUS_FILTER_OPTIONS } from "@/lib/document-status";

type Props = {
  value?: string;
  title?: string;
  documentType?: string;
  downloadStatus?: DownloadStatusFilter;
  approvalFrom?: string;
  approvalTo?: string;
  showDownloadFilters?: boolean;
  mrType?: MrTypeFilter;
  poStatus?: PoStatusFilter;
  errType?: ErrTypeFilter;
  errStatus?: ErrStatusFilter;
  showMrTypeFilter?: boolean;
  showPoStatusFilter?: boolean;
  showErrTypeFilter?: boolean;
  showErrStatusFilter?: boolean;
  showDocumentTypeFilter?: boolean;
  showErrDocumentType?: boolean;
  showStatusFilter?: boolean;
  statusFilterOptions?: Array<{ value: string; label: string }>;
  location?: string;
};

export default function DocumentStatusFilter({ value = "", title = "Status", documentType = "", downloadStatus = "", approvalFrom = "", approvalTo = "", showDownloadFilters = false, mrType = "", poStatus = "", errType = "", errStatus = "", location = "", showMrTypeFilter = false, showPoStatusFilter = false, showErrTypeFilter = false, showErrStatusFilter = false, showDocumentTypeFilter = false, showErrDocumentType = true, showStatusFilter = true, statusFilterOptions = DOCUMENT_STATUS_FILTER_OPTIONS }: Props) {
  return (
    <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      {showDocumentTypeFilter ? (
        <div className="min-w-0 flex-1">
          <label htmlFor="document-type" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Document Type</label>
          <select id="document-type" name="documentType" defaultValue={documentType} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400">
            <option value="">All</option>
            <option value="MATERIAL_REQUISITION">MRs</option>
            <option value="COMPARISON">Comparison Sheets</option>
            {showErrDocumentType ? <option value="ERR">ERRs</option> : null}
          </select>
        </div>
      ) : documentType ? <input type="hidden" name="documentType" value={documentType} /> : null}
      {location ? <input type="hidden" name="location" value={location} /> : null}
      {showMrTypeFilter && documentType === "MATERIAL_REQUISITION" ? (
        <div className="min-w-0 flex-1">
          <label htmlFor="mr-type" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">MR Type</label>
          <select id="mr-type" name="mrType" defaultValue={mrType} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400">
            <option value="">All MR Types</option>
            <option value="CASH">Cash</option>
            <option value="CREDIT">Credit</option>
          </select>
        </div>
      ) : null}
      {showPoStatusFilter && documentType === "MATERIAL_REQUISITION" ? (
        <div className="min-w-0 flex-1">
          <label htmlFor="po-status" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">PO Status</label>
          <select id="po-status" name="poStatus" defaultValue={poStatus} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400">
            <option value="">All PO Statuses</option>
            <option value="UPLOADED">PO Uploaded</option>
            <option value="PENDING">PO Pending</option>
            <option value="NOT_APPLICABLE">Not Applicable</option>
          </select>
        </div>
      ) : null}
      {showErrTypeFilter && documentType === "ERR" ? (
        <div className="min-w-0 flex-1">
          <label htmlFor="err-type" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">ERR Type</label>
          <select id="err-type" name="errType" defaultValue={errType} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400">
            <option value="">All ERR Types</option>
            <option value="RENTAL_ACTC">Rental ACTC</option>
            <option value="RENTAL_EXTERNAL">Rental External</option>
            <option value="PURCHASE">Purchase</option>
          </select>
        </div>
      ) : null}
      {showDownloadFilters ? (
        <>
          <div className="min-w-0 flex-1">
            <label htmlFor="download-status" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Download Status</label>
            <select id="download-status" name="downloadStatus" defaultValue={downloadStatus} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400">
              <option value="">All</option>
              <option value="DOWNLOADED">Downloaded</option>
              <option value="NOT_DOWNLOADED">Not Downloaded</option>
            </select>
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="approval-from" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Approval Date/Time From</label>
            <input id="approval-from" type="datetime-local" name="approvalFrom" defaultValue={approvalFrom} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400" />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="approval-to" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Approval Date/Time To</label>
            <input id="approval-to" type="datetime-local" name="approvalTo" defaultValue={approvalTo} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400" />
          </div>
        </>
      ) : null}
      {showStatusFilter ? (
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</label>
          <select
            name="status"
            defaultValue={value}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400"
          >
            <option value="">All</option>
            {statusFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        Apply Filter
      </button>
    </form>
  );
}
