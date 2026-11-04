import MultiSelectFilter from "@/components/multi-select-filter";
import { DOCUMENT_STATUS_FILTER_OPTIONS, type DownloadStatusFilter } from "@/lib/document-status";

export type FilterDocumentType = {
  code: string;
  name: string;
  subtypes: Array<{ code: string; name: string }>;
};

type Props = {
  // Status, type, sub type, project and location are multi-select: each takes the list of ticked values.
  value?: string[];
  title?: string;
  documentType?: string[];
  documentSubtype?: string[];
  project?: string[];
  location?: string[];
  downloadStatus?: DownloadStatusFilter;
  approvalFrom?: string;
  approvalTo?: string;
  showDownloadFilters?: boolean;
  // The approval date range only makes sense for approved documents; defaults to following showDownloadFilters.
  showApprovalDateFilters?: boolean;
  // Search box inside the filter bar (type, number, title, project, approver...). The page applies it.
  showSearch?: boolean;
  search?: string;
  // When one page holds several filter bars, each bar names its fields with its own prefix (e.g. "rv_status").
  fieldPrefix?: string;
  // Other query parameters to keep when this bar is submitted (e.g. the other bar's filters).
  preserve?: Record<string, string | string[]>;
  showDocumentTypeFilter?: boolean;
  showProjectFilter?: boolean;
  showLocationFilter?: boolean;
  showStatusFilter?: boolean;
  statusFilterOptions?: Array<{ value: string; label: string }>;
  // Document types (with their sub types) and projects come from the database, so the filter never needs editing.
  documentTypes?: FilterDocumentType[];
  projects?: Array<{ id: string; code: string; name: string }>;
  locations?: Array<{ id: string; name: string }>;
};

const selectClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-slate-400";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600";

export default function DocumentStatusFilter({
  value = [],
  title = "Status",
  documentType = [],
  documentSubtype = [],
  project = [],
  location = [],
  downloadStatus = "",
  approvalFrom = "",
  approvalTo = "",
  showDownloadFilters = false,
  showApprovalDateFilters,
  showSearch = true,
  search = "",
  fieldPrefix = "",
  preserve = {},
  showDocumentTypeFilter = true,
  showProjectFilter = true,
  showLocationFilter = true,
  showStatusFilter = true,
  statusFilterOptions = DOCUMENT_STATUS_FILTER_OPTIONS,
  documentTypes = [],
  projects = [],
  locations = [],
}: Props) {
  // Sub types on offer: those of every ticked document type (labelled with their type when several are ticked).
  const selectedTypes = documentTypes.filter((type) => documentType.includes(type.code));
  const subtypeOptions = selectedTypes.flatMap((type) =>
    type.subtypes.map((subtype) => ({ value: subtype.code, label: selectedTypes.length > 1 ? `${type.name} - ${subtype.name}` : subtype.name })),
  );
  // The same sub type code under two ticked types is offered once.
  const uniqueSubtypeOptions = subtypeOptions.filter((option, index) => subtypeOptions.findIndex((other) => other.value === option.value) === index);
  const showDates = showApprovalDateFilters ?? showDownloadFilters;
  const n = (name: string) => `${fieldPrefix}${name}`;

  return (
    <form method="get" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      {Object.entries(preserve).flatMap(([key, val]) =>
        (Array.isArray(val) ? val : [val]).filter(Boolean).map((item, index) => <input key={`${key}-${index}`} type="hidden" name={key} value={item} />),
      )}
      {showSearch ? (
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor={n("search")} className={labelClass}>Search</label>
          <input
            id={n("search")}
            type="search"
            name={n("search")}
            defaultValue={search}
            placeholder="Number, title, project, approver..."
            className={selectClass}
          />
        </div>
      ) : null}
      {showDocumentTypeFilter ? (
        <div className="min-w-0 flex-1">
          <label htmlFor={n("document-type")} className={labelClass}>Document Type</label>
          <MultiSelectFilter
            id={n("document-type")}
            name={n("documentType")}
            allLabel="All"
            defaultValues={documentType}
            options={documentTypes.map((type) => ({ value: type.code, label: type.name }))}
          />
        </div>
      ) : (
        documentType.map((code) => <input key={code} type="hidden" name={n("documentType")} value={code} />)
      )}

      {uniqueSubtypeOptions.length > 0 ? (
        <div className="min-w-0 flex-1">
          <label htmlFor={n("document-subtype")} className={labelClass}>Sub Type</label>
          <MultiSelectFilter
            id={n("document-subtype")}
            name={n("documentSubtype")}
            allLabel="All sub types"
            defaultValues={documentSubtype}
            options={uniqueSubtypeOptions}
          />
        </div>
      ) : null}

      {showLocationFilter && locations.length > 0 ? (
        <div className="min-w-0 flex-1">
          <label htmlFor={n("location")} className={labelClass}>Location</label>
          <MultiSelectFilter
            id={n("location")}
            name={n("location")}
            allLabel="All locations"
            defaultValues={location}
            options={locations.map((item) => ({ value: item.id, label: item.name }))}
          />
        </div>
      ) : null}

      {showProjectFilter && projects.length > 0 ? (
        <div className="min-w-0 flex-1">
          <label htmlFor={n("project")} className={labelClass}>Project</label>
          <MultiSelectFilter
            id={n("project")}
            name={n("project")}
            allLabel="All projects"
            defaultValues={project}
            options={projects.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
          />
        </div>
      ) : null}

      {showDownloadFilters ? (
        <div className="min-w-0 flex-1">
          <label htmlFor={n("download-status")} className={labelClass}>Download Status</label>
          <select id={n("download-status")} name={n("downloadStatus")} defaultValue={downloadStatus} className={selectClass}>
            <option value="">All</option>
            <option value="DOWNLOADED">Downloaded</option>
            <option value="NOT_DOWNLOADED">Not Downloaded</option>
          </select>
        </div>
      ) : null}
      {showDates ? (
        <>
          <div className="min-w-0 flex-1">
            <label htmlFor={n("approval-from")} className={labelClass}>Approval Date/Time From</label>
            <input id={n("approval-from")} type="datetime-local" name={n("approvalFrom")} defaultValue={approvalFrom} className={selectClass} />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor={n("approval-to")} className={labelClass}>Approval Date/Time To</label>
            <input id={n("approval-to")} type="datetime-local" name={n("approvalTo")} defaultValue={approvalTo} className={selectClass} />
          </div>
        </>
      ) : null}

      {showStatusFilter ? (
        <div className="min-w-0 flex-1">
          <label htmlFor={n("status")} className={labelClass}>{title}</label>
          <MultiSelectFilter id={n("status")} name={n("status")} allLabel="All" defaultValues={value} options={statusFilterOptions} />
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
