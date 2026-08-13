'use client';

import { useMemo, useState } from 'react';
import type { DocumentStatus } from '@prisma/client';
import StatusBadge from '@/components/status-badge';

export type PipelineStage = {
  key: string;
  label: string;
  count: number;
  averageDaysPending: number;
  oldestPendingDocument: { documentNumber: string; title: string } | null;
};

export type PipelineDocument = {
  id: string;
  documentNumber: string;
  title: string;
  currentApproverName: string | null;
  status: DocumentStatus;
  statusLabel: string;
  stageKey: string;
  daysPending: number;
  createdAtLabel: string;
};

type Props = {
  stages: PipelineStage[];
  documents: PipelineDocument[];
};

function formatDays(days: number) {
  return `${days} day${days === 1 ? '' : 's'}`;
}

export default function WorkflowPipelineChart({ stages, documents }: Props) {
  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(stages[1]?.key ?? null);

  const activeStage = useMemo(
    () => stages.find((stage) => stage.key === selectedStageKey) ?? null,
    [selectedStageKey, stages],
  );

  const filteredDocuments = useMemo(() => {
    if (!selectedStageKey) {
      return documents;
    }

    return documents.filter((document) => document.stageKey === selectedStageKey);
  }, [documents, selectedStageKey]);

  const maxCount = Math.max(1, ...stages.map((stage) => stage.count));

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Workflow pipeline</p>
            <p className="mt-1 text-sm text-slate-600">
              Click a stage to focus the document list below.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedStageKey(null)}
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Show all
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stages.map((stage) => {
            const isActive = selectedStageKey === stage.key;
            const height = stage.count === 0 ? 18 : Math.max(24, (stage.count / maxCount) * 100);

            return (
              <button
                key={stage.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => setSelectedStageKey(stage.key)}
                className={`rounded-2xl border p-3 text-left transition ${
                  isActive
                    ? stage.key === 'APPROVER_1'
                      ? 'border-amber-200 bg-amber-50 text-amber-900 shadow-sm ring-1 ring-amber-200'
                      : stage.key === 'APPROVER_2'
                        ? 'border-sky-200 bg-sky-50 text-sky-900 shadow-sm ring-1 ring-sky-200'
                        : stage.key === 'APPROVER_3'
                          ? 'border-violet-200 bg-violet-50 text-violet-900 shadow-sm ring-1 ring-violet-200'
                          : stage.key === 'REVISION_REQUIRED'
                            ? 'border-orange-200 bg-orange-50 text-orange-900 shadow-sm ring-1 ring-orange-200'
                            : stage.key === 'APPROVED'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 shadow-sm ring-1 ring-emerald-200'
                              : 'border-slate-200 bg-slate-100 text-slate-900 shadow-sm ring-1 ring-slate-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
                title={`Stage: ${stage.label}\nDocuments: ${stage.count}\nAverage days pending: ${formatDays(stage.averageDaysPending)}\nOldest pending: ${stage.oldestPendingDocument ? `${stage.oldestPendingDocument.documentNumber} - ${stage.oldestPendingDocument.title}` : 'None'}`}
              >
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{stage.label}</p>
                  <p className="mt-1 text-lg font-semibold">{stage.count}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {activeStage ? `${activeStage.label} documents` : 'All documents'}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {activeStage
                ? `${activeStage.count} document${activeStage.count === 1 ? '' : 's'} currently in this stage.`
                : 'Select a stage to filter the table below.'}
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700">
            {filteredDocuments.length} shown
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Document Number</th>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Current Approver</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Days Pending</th>
                <th className="px-4 py-3 font-semibold">Created Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocuments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No documents are currently in this stage.
                  </td>
                </tr>
              ) : (
                filteredDocuments.map((document) => (
                  <tr key={document.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <a href={`/documents/${document.id}`} className="text-slate-900 hover:text-slate-700 hover:underline">
                        {document.documentNumber}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{document.title}</td>
                    <td className="px-4 py-3 text-slate-700">{document.currentApproverName || 'Unassigned'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={document.status} label={document.statusLabel} />
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatDays(document.daysPending)}</td>
                    <td className="px-4 py-3 text-slate-500">{document.createdAtLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
