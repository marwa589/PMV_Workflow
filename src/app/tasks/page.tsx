// src/app/tasks/page.tsx
import Link from "next/link";
import { DocumentStatus } from "@prisma/client";
import ApproverPendingTable from "@/components/approver-pending-table";
import DashboardShell from "@/components/dashboard-shell";
import DocumentStatusFilter from "@/components/document-status-filter";
import { loadFilterOptions } from "@/components/document-list-page";
import { applyListFilters, parseListFilters, type ListSearchParams } from "@/lib/document-list";
import { matchesDocumentSearch } from "@/lib/document-search";
import { withDownloadTracking } from "@/lib/download-tracking";
import { requireAuth } from "@/lib/auth/guards";
import { userCanBulkApprove } from "@/lib/bulk-approve";
import { getActionableDocuments } from "@/lib/document-queries";
import { prisma } from "@/lib/prisma";
import { USER_TYPE } from "@/lib/auth/roles";
import { getUploadTasks } from "@/lib/workflow/processes";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

// The two tables each have their own filter bar; their fields are told apart by a prefix in the address.
const REVIEW_PREFIX = "rv_";
const UPLOAD_PREFIX = "up_";
const REVIEW_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "REVISION_REQUIRED", label: "Revision Required" },
];

function withoutPrefix(params: NonNullable<ListSearchParams>, prefix: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(prefix)) continue;
    const text = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
    result[key.slice(prefix.length)] = text;
  }
  return result;
}

function onlyPrefix(params: NonNullable<ListSearchParams>, prefix: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(prefix)) continue;
    result[key] = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
  return result;
}

/**
 * My Tasks: everything waiting for this person.
 *  - Document upload: running processes whose next document this person may upload (they pick the branch).
 *  - Document review: documents waiting for their approval, on hold, or sent back to them for revision.
 */
export default async function MyTasksPage({ searchParams }: { searchParams?: Promise<NonNullable<ListSearchParams>> }) {
  const session = await requireAuth();
  const user = { userId: session.userId, userType: session.userType };
  const isAdmin = session.userType === USER_TYPE.ADMIN;
  const params = (await searchParams) ?? {};
  const reviewFilters = parseListFilters(withoutPrefix(params, REVIEW_PREFIX));
  const uploadFilters = parseListFilters(withoutPrefix(params, UPLOAD_PREFIX));

  const [allUploadTasks, allReviewDocuments, canBulkApprove, { documentTypes, projects }] = await Promise.all([
    getUploadTasks(prisma, user),
    getActionableDocuments(user, [DocumentStatus.PENDING, DocumentStatus.ON_HOLD, DocumentStatus.REVISION_REQUIRED]),
    userCanBulkApprove(session.userId),
    loadFilterOptions(),
  ]);

  // Same filters as the document lists. Download status is per person (documents are usually downloaded before they are approved or rejected).
  const trackedReview = await withDownloadTracking(allReviewDocuments, session.userId);
  const reviewDocuments = applyListFilters(trackedReview, reviewFilters);
  const uploadTasks = allUploadTasks.filter((task) => {
    if (uploadFilters.documentType && !task.options.some((option) => option.typeCode === uploadFilters.documentType)) return false;
    if (uploadFilters.documentSubtype && !task.options.some((option) => option.subtypeCode === uploadFilters.documentSubtype)) return false;
    if (uploadFilters.project && task.project?.id !== uploadFilters.project) return false;
    return matchesDocumentSearch(
      {
        documentNumber: task.lastDocument?.documentNumber,
        title: [task.processName, task.reference, task.afterStepName, task.lastDocument?.title, ...task.options.map((option) => option.name)].filter(Boolean).join(" "),
        documentTypeName: task.options.map((option) => `${option.typeName} ${option.typeCode}`).join(" "),
        documentSubtypeName: task.options.map((option) => option.subtypeName).filter(Boolean).join(" "),
        projectName: task.project?.name,
        projectCode: task.project?.code,
      },
      uploadFilters.search,
    );
  });

  return (
    <DashboardShell
      role={session.userType}
      userName={session.name}
      title="My Tasks"
      subtitle={`${allUploadTasks.length} to upload · ${allReviewDocuments.length} to review`}
    >
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Document upload</h3>
            <p className="mt-1 text-sm text-slate-500">
              Documents linked to ones you already uploaded are waiting for their next document. Choose the document to upload and it is linked automatically.
            </p>
          </div>
          {isAdmin ? <Link href="/processes" className="text-sm font-medium text-cyan-700 hover:underline">View all process runs</Link> : null}
        </div>

        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            fieldPrefix={UPLOAD_PREFIX}
            preserve={onlyPrefix(params, REVIEW_PREFIX)}
            documentType={uploadFilters.documentType}
            documentSubtype={uploadFilters.documentSubtype}
            project={uploadFilters.project}
            search={uploadFilters.search}
            showStatusFilter={false}
            documentTypes={documentTypes}
            projects={projects}
          />
        </div>

        {uploadTasks.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">{allUploadTasks.length === 0 ? "No documents are waiting for you to upload." : "No upload tasks match these filters."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {isAdmin ? <th className="px-5 py-3 font-semibold">Process</th> : null}
                  <th className="px-5 py-3 font-semibold">Project</th>
                  <th className="px-5 py-3 font-semibold">Linked document</th>
                  <th className="px-5 py-3 font-semibold">Next document (choose one)</th>
                  <th className="px-5 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {uploadTasks.map((task) => (
                  <tr key={task.runId} className="border-t border-slate-100 align-top hover:bg-slate-50/50">
                    {isAdmin ? (
                      <td className="px-5 py-4">
                        <Link href={`/processes/${task.runId}`} className="font-medium text-slate-900 hover:text-indigo-600 hover:underline">
                          {task.processName}
                        </Link>
                        {task.reference ? <div className="text-xs text-slate-500">{task.reference}</div> : null}
                      </td>
                    ) : null}
                    <td className="px-5 py-4 text-slate-700">{task.project ? `${task.project.code} - ${task.project.name}` : "—"}</td>
                    <td className="px-5 py-4 text-slate-700">
                      <div>{task.afterStepName}</div>
                      {task.lastDocument ? (
                        <Link href={`/documents/${task.lastDocument.id}`} className="text-xs text-cyan-700 hover:underline">
                          {task.lastDocument.documentNumber}
                          {task.lastDocument.approvedAt ? ` · approved ${dateFormat.format(task.lastDocument.approvedAt)}` : ""}
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        {task.options.map((option) => (
                          <span key={option.stepId} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {option.name}
                            <span className="font-normal text-slate-500"> · {option.typeName}{option.subtypeName ? ` - ${option.subtypeName}` : ""}</span>
                            {option.referenceTypeName ? <span className="font-normal text-cyan-700"> · reference: {option.referenceTypeName}</span> : null}
                            {option.waitingUntil ? <span className="font-normal text-amber-700"> · waiting period until {dateTimeFormat.format(option.waitingUntil)} (Admin can upload now)</span> : null}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/new-document?processInstanceId=${task.runId}`}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                      >
                        Upload
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">Document review</h3>
          <p className="mt-1 text-sm text-slate-500">Documents waiting for your approval, on hold, or sent back to you for revision.</p>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            fieldPrefix={REVIEW_PREFIX}
            preserve={onlyPrefix(params, UPLOAD_PREFIX)}
            value={reviewFilters.status}
            documentType={reviewFilters.documentType}
            documentSubtype={reviewFilters.documentSubtype}
            project={reviewFilters.project}
            downloadStatus={reviewFilters.downloadStatus}
            search={reviewFilters.search}
            showDownloadFilters
            showApprovalDateFilters={false}
            statusFilterOptions={REVIEW_STATUS_OPTIONS}
            documentTypes={documentTypes}
            projects={projects}
          />
        </div>
        <div className="px-1 py-4">
          <ApproverPendingTable
            showVersion={isAdmin}
            emptyMessage={allReviewDocuments.length === 0 ? "No documents are waiting for your review." : "No documents match these filters."}
            allowBatch={canBulkApprove}
            documents={reviewDocuments.map((row) => ({
              id: row.id,
              documentNumber: row.documentNumber,
              title: row.title,
              projectLabel: row.project ? `${row.project.code} - ${row.project.name}` : null,
              statusLabel: row.statusLabel,
              currentVersion: row.currentVersion,
              latestComment: row.latestComment,
              uploadedAt: dateFormat.format(row.createdAt),
              batchEligible: row.status === DocumentStatus.PENDING,
            }))}
          />
        </div>
      </section>
    </DashboardShell>
  );
}
