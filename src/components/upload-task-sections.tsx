"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Files } from "lucide-react";
import UploadTasksTable, { type UploadTaskRow } from "@/components/upload-tasks-table";

export type UploadTaskSection = {
  key: string;
  // "Purchase Order - Local", the type and sub type the section waits for.
  label: string;
  rows: UploadTaskRow[];
  // Set when several of these can be uploaded together ("Upload several"), each linked to its task by name.
  bulkHref: string | null;
};

/**
 * My Tasks, "To upload": the awaiting documents grouped by the sub type they wait for. Each group can be folded away,
 * and a group with more than one task offers "Upload several", which matches every dropped file to its own task.
 */
export default function UploadTaskSections({ sections, showWhoCanUpload = false }: { sections: UploadTaskSection[]; showWhoCanUpload?: boolean }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const allClosed = sections.every((section) => closed[section.key]);

  return (
    <div>
      {sections.length > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/60 px-5 py-2.5">
          <div className="flex flex-wrap gap-1.5">
            {sections.map((section) => (
              <a
                key={section.key}
                href={`#upload-section-${section.key}`}
                onClick={() => setClosed((current) => ({ ...current, [section.key]: false }))}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              >
                {section.label} <span className="ml-0.5 text-slate-500">{section.rows.length}</span>
              </a>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setClosed(Object.fromEntries(sections.map((section) => [section.key, !allClosed])))}
            className="text-xs font-medium text-cyan-700 hover:underline"
          >
            {allClosed ? "Expand all" : "Collapse all"}
          </button>
        </div>
      ) : null}

      <div className="divide-y divide-slate-200">
        {sections.map((section) => {
          const open = !closed[section.key];
          return (
            <section key={section.key} id={`upload-section-${section.key}`} className="scroll-mt-24">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setClosed((current) => ({ ...current, [section.key]: open }))}
                  aria-expanded={open}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`} />
                  <span className="text-sm font-semibold text-slate-900">{section.label}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{section.rows.length} awaiting</span>
                </button>
                {section.bulkHref ? (
                  <Link
                    href={section.bulkHref}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                    title={`Upload several ${section.label} documents at once; each file is linked to its task by its name`}
                  >
                    <Files className="h-3.5 w-3.5" />
                    Upload several
                  </Link>
                ) : null}
              </div>
              {open ? <UploadTasksTable rows={section.rows} showWhoCanUpload={showWhoCanUpload} /> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
