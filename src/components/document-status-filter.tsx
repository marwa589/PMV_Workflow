import { DOCUMENT_STATUS_FILTER_OPTIONS, type DownloadStatusFilter } from "@/lib/document-status";

export type FilterDocumentType = {
  code: string;
  name: string;
  subtypes: Array<{ code: string; name: string }>;
};

type Props = {
  value?: string;
  title?: string;
  documentType?: string;
  documentSubtype?: string;
  project?: string;
  downloadStatus?: DownloadStatusFilter;
  approvalFrom?: string;
  approvalTo?: string;
  showDownloadFilters?: boolean;
  showDocumentTypeFilter?: boolean;
  showProjectFilter?: boolean;
  showStatusFilter?: boolean;
  statusFilterOptions?: Array<{ value: string; label: string }>;
  // Document types (with their sub types) and projects come from the database, so the filter never needs editing.
  documentTypes?: FilterDocumentType[];
  projects?: Array<{ id: string; code: string; name: string }>;
};

const selectClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600";

export default function DocumentStatusFilter({
  value = "",
  title = "Status",
  documentType = "",
  documentSubtype = "",
  project = "",
  downloadStatus = "",
  approvalFrom = "",
  approvalTo = "",
  showDownloadFilters = false,
  showDocumentTypeFilter = true,
  showProjectFilter = true,
  showStatusFilter = true,
  statusFilterOptions = DOCUMENT_STATUS_FILTER_OPTIONS,
  documentTypes = [],
  projects = [],
}: Props) {
  const selectedType = documentTypes.find((type) => type.code === documentType);

  return (
    <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      {showDocumentTypeFilter ? (
        <div className="min-w-0 flex-1">
          <label htmlFor="document-type" className={labelClass}>Document Type</label>
          <select id="document-type" name="documentType" defaultValue={documentType} className={selectClass}>
            <option value="">All</option>
            {documentTypes.map((type) => (
              <option key={type.code} value={type.code}>{type.name}</option>
            ))}
          </select>
        </div>
      ) : documentType ? (
        <input type="hidden" name="documentType" value={documentType} />
      ) : null}

      {selectedType && selectedType.subtypes.length > 0 ? (
        <div className="min-w-0 flex-1">
          <label htmlFor="document-subtype" className={labelClass}>Sub Type</label>
          <select id="document-subtype" name="documentSubtype" defaultValue={documentSubtype} className={selectClass}>
            <option value="">All sub types</option>
            {selectedType.subtypes.map((subtype) => (
              <option key={subtype.code} value={subtype.code}>{subtype.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {showProjectFilter && projects.length > 0 ? (
        <div className="min-w-0 flex-1">
          <label htmlFor="project" className={labelClass}>Project</label>
          <select id="project" name="project" defaultValue={project} className={selectClass}>
            <option value="">All projects</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>{item.code} - {item.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {showDownloadFilters ? (
        <>
          <div className="min-w-0 flex-1">
            <label htmlFor="download-status" className={labelClass}>Download Status</label>
            <select id="download-status" name="downloadStatus" defaultValue={downloadStatus} className={selectClass}>
              <option value="">All</option>
              <option value="DOWNLOADED">Downloaded</option>
              <option value="NOT_DOWNLOADED">Not Downloaded</option>
            </select>
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="approval-from" className={labelClass}>Approval Date/Time From</label>
            <input id="approval-from" type="datetime-local" name="approvalFrom" defaultValue={approvalFrom} className={selectClass} />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="approval-to" className={labelClass}>Approval Date/Time To</label>
            <input id="approval-to" type="datetime-local" name="approvalTo" defaultValue={approvalTo} className={selectClass} />
          </div>
        </>
      ) : null}

      {showStatusFilter ? (
        <div className="min-w-0 flex-1">
          <label className={labelClass}>{title}</label>
          <select name="status" defaultValue={value} className={selectClass}>
            <option value="">All</option>
            {statusFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
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
