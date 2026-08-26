import { DocumentStatus } from "@prisma/client";
import { DOCUMENT_STATUS_FILTER_OPTIONS, DownloadStatusFilter, MrTypeFilter } from "@/lib/document-status";

type Props = {
  value?: DocumentStatus | "";
  title?: string;
  documentType?: string;
  downloadStatus?: DownloadStatusFilter;
  approvalFrom?: string;
  approvalTo?: string;
  showDownloadFilters?: boolean;
  mrType?: MrTypeFilter;
  showMrTypeFilter?: boolean;
};

export default function DocumentStatusFilter({ value = "", title = "Filter by Status", documentType = "", downloadStatus = "", approvalFrom = "", approvalTo = "", showDownloadFilters = false, mrType = "", showMrTypeFilter = false }: Props) {
  return (
    <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      {documentType ? <input type="hidden" name="documentType" value={documentType} /> : null}
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
      <div className="min-w-0 flex-1">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</label>
        <select
          name="status"
          defaultValue={value}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400"
        >
          <option value="">All Statuses</option>
          {DOCUMENT_STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        Apply Filter
      </button>
    </form>
  );
}
