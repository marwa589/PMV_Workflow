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
  errCountry?: "KSA" | "KUWAIT" | "";
  errProjectId?: string;
  errCountries?: Array<"KSA" | "KUWAIT">;
  errProjects?: Array<{ id: string; name: string }>;
  showErrScopeFilters?: boolean;
  showErrCountryFilter?: boolean;
  showErrProjectFilter?: boolean;
  gridLayout?: boolean;
  hiddenFields?: Record<string, string>;
};

export default function DocumentStatusFilter({ value = "", title = "Status", documentType = "", downloadStatus = "", approvalFrom = "", approvalTo = "", showDownloadFilters = false, mrType = "", poStatus = "", errType = "", errStatus = "", location = "", errCountry = "", errProjectId = "", errCountries = [], errProjects = [], showErrScopeFilters = false, showErrCountryFilter = false, showErrProjectFilter = false, gridLayout = false, hiddenFields = {}, showMrTypeFilter = false, showPoStatusFilter = false, showErrTypeFilter = false, showErrStatusFilter = false, showDocumentTypeFilter = false, showErrDocumentType = true, showStatusFilter = true, statusFilterOptions = DOCUMENT_STATUS_FILTER_OPTIONS }: Props) {
  return (
    <form method="get" className={gridLayout ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" : "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"}>
      {Object.entries(hiddenFields).map(([key, fieldValue]) => (
        <input key={key} type="hidden" name={key} value={fieldValue} />
      ))}
      {showDocumentTypeFilter ? (
        <div className="min-w-0 flex-1">
          <label htmlFor="document-type" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Document Type</label>
          <select id="document-type" name="documentType" defaultValue={documentType} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400">
            <option value="">All</option>
            <option value="MATERIAL_REQUISITION">MRs</option>
            <option value="COMPARISON">Comparison Sheets</option>
            <option value="CUSTODY">Custody Files</option>
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
            <option value="RENEWAL">Renewal</option>
            <option value="PURCHASE">Purchase</option>
          </select>
        </div>
      ) : null}
      {showErrScopeFilters && documentType === "ERR" ? (
        <>
          {showErrCountryFilter ? (
            <div className="min-w-0 flex-1">
              <label htmlFor="err-country" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Country</label>
              <select id="err-country" name="country" defaultValue={errCountry} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400">
                <option value="">All accessible countries</option>
                {errCountries.map((country) => (
                  <option key={country} value={country}>{country === "KUWAIT" ? "Kuwait" : "KSA"}</option>
                ))}
              </select>
            </div>
          ) : null}
          {showErrProjectFilter || errProjects.length > 1 ? (
            <div className="min-w-0 flex-1">
              <label htmlFor="err-project" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Project</label>
              <select id="err-project" name="projectId" defaultValue={errProjectId} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400">
                <option value="">All accessible projects</option>
                {errProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
          ) : null}
        </>
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
        className={gridLayout
          ? "inline-flex h-[38px] w-full self-end items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-700"
          : "inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"}
      >
        Apply Filter
      </button>
    </form>
  );
}
