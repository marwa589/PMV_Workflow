import { DocumentStatus } from "@prisma/client";
import { DOCUMENT_STATUS_FILTER_OPTIONS } from "@/lib/document-status";

type Props = {
  value?: DocumentStatus | "";
  title?: string;
  documentType?: string;
};

export default function DocumentStatusFilter({ value = "", title = "Filter by Status", documentType = "" }: Props) {
  return (
    <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      {documentType ? <input type="hidden" name="documentType" value={documentType} /> : null}
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
