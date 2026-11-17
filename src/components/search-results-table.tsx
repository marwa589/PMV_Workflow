"use client";

import Link from "next/link";
import StatusBadge from "@/components/status-badge";
import { Pager, usePagination } from "@/components/pager";

export type SearchResultRow = {
  id: string;
  documentNumber: string;
  title: string;
  typeLabel: string;
  projectLabel: string | null;
  status: string;
  statusLabel?: string;
  downloaded: boolean;
  createdLabel: string;
};

/** Results of the top-bar search, split into pages like every other table. */
export default function SearchResultsTable({ rows }: { rows: SearchResultRow[] }) {
  const pagination = usePagination(rows, { storageKey: "search-results", initialPageSize: 25 });

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Number</th>
              <th className="px-5 py-3 font-semibold">Title</th>
              <th className="px-5 py-3 font-semibold">Type</th>
              <th className="px-5 py-3 font-semibold">Project</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((hit) => (
              <tr key={hit.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-5 py-3"><Link href={`/documents/${hit.id}`} className="font-medium text-cyan-700 hover:underline">{hit.documentNumber}</Link></td>
                <td className="px-5 py-3 text-slate-800">{hit.title}</td>
                <td className="px-5 py-3 text-slate-600">{hit.typeLabel}</td>
                <td className="px-5 py-3 text-slate-600">{hit.projectLabel ?? "—"}</td>
                <td className="px-5 py-3"><StatusBadge status={hit.status} label={hit.statusLabel} downloaded={hit.downloaded} /></td>
                <td className="px-5 py-3 text-slate-500">{hit.createdLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager {...pagination} noun="documents" />
    </>
  );
}
