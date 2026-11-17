"use client";

import Link from "next/link";
import { useColumnPreferences } from "@/components/column-picker";
import { Pager, usePagination } from "@/components/pager";
import WhoCanAct from "@/components/admin/who-can-act";
import type { EligiblePerson } from "@/lib/workflow/eligible-people-types";

export type UploadTaskRow = {
  runId: string;
  awaiting: Array<{ stepId: string; name: string; typeLabel: string; waitingNote: string | null; uploaders?: EligiblePerson[] }>;
  linked: { id: string; documentNumber: string; title: string } | null;
  dateLabel: string;
  projectLabel: string;
  // Where "Upload" goes (defaults to the run, where the uploader picks the document).
  uploadHref?: string;
  // Other documents the same run could continue with instead (shown under the awaiting document).
  alternatives?: string[];
};

export default function UploadTasksTable({ rows, showWhoCanUpload = false }: { rows: UploadTaskRow[]; showWhoCanUpload?: boolean }) {
  const { isShown, picker } = useColumnPreferences("upload-tasks", [
    { key: "awaiting", label: "Awaiting document" },
    { key: "linked", label: "Linked document" },
    { key: "date", label: "Date" },
    { key: "project", label: "Project" },
    ...(showWhoCanUpload ? [{ key: "who", label: "Who can upload" }] : []),
  ]);
  const pagination = usePagination(rows, { storageKey: "upload-tasks", initialPageSize: 25 });

  return (
    <div>
      <div className="flex justify-end px-5 py-2">{picker}</div>
      {/* Scrolls inside its own box with the column titles kept in view. */}
      <div className="max-h-[70vh] overflow-auto border-t border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 shadow-[inset_0_-1px_0_rgb(226_232_240)]">
            <tr>
              {isShown("awaiting") ? <th className="px-5 py-3 font-semibold">Awaiting document</th> : null}
              {isShown("linked") ? <th className="px-5 py-3 font-semibold">Linked document</th> : null}
              {isShown("date") ? <th className="px-5 py-3 font-semibold">Date</th> : null}
              {isShown("project") ? <th className="px-5 py-3 font-semibold">Project</th> : null}
              {showWhoCanUpload && isShown("who") ? <th className="px-5 py-3 font-semibold">Who can upload</th> : null}
              <th className="px-5 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((row) => (
              <tr key={`${row.runId}|${row.awaiting.map((option) => option.stepId).join(",")}`} className="border-t border-slate-100 align-top hover:bg-slate-50/50">
                {isShown("awaiting") ? (
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                      {row.awaiting.map((option) => (
                        <span key={option.stepId} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                          {option.name}
                          <span className="font-normal text-slate-500"> · {option.typeLabel}</span>
                          {option.waitingNote ? <span className="font-normal text-amber-700"> · {option.waitingNote}</span> : null}
                        </span>
                      ))}
                    </div>
                    {row.alternatives && row.alternatives.length > 0 ? (
                      <p className="mt-1.5 text-xs text-slate-500">Or instead: {row.alternatives.join(", ")}</p>
                    ) : null}
                  </td>
                ) : null}
                {isShown("linked") ? (
                  <td className="px-5 py-4 text-slate-700">
                    {row.linked ? (
                      <Link href={`/documents/${row.linked.id}`} className="text-cyan-700 hover:underline">
                        {row.linked.documentNumber}
                        <span className="block text-xs text-slate-500">{row.linked.title}</span>
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
                {isShown("date") ? <td className="px-5 py-4 text-slate-700">{row.dateLabel}</td> : null}
                {isShown("project") ? <td className="px-5 py-4 text-slate-700">{row.projectLabel}</td> : null}
                {showWhoCanUpload && isShown("who") ? (
                  <td className="px-5 py-4">
                    <div className="space-y-2">
                      {row.awaiting.map((option) => (
                        <WhoCanAct key={option.stepId} people={option.uploaders ?? []} label={row.awaiting.length > 1 ? `${option.name}: who can upload` : "Who can upload"} />
                      ))}
                    </div>
                  </td>
                ) : null}
                <td className="px-5 py-4">
                  <Link href={row.uploadHref ?? `/new-document?processInstanceId=${row.runId}`} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
                    Upload
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager {...pagination} noun="upload tasks" />
    </div>
  );
}
