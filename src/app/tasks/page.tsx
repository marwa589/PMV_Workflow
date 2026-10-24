// src/app/tasks/page.tsx
import Link from "next/link";
import { DocumentStatus } from "@prisma/client";
import ApproverPendingTable from "@/components/approver-pending-table";
import DashboardShell from "@/components/dashboard-shell";
import { requireAuth } from "@/lib/auth/guards";
import { userCanBulkApprove } from "@/lib/bulk-approve";
import { getActionableDocuments } from "@/lib/document-queries";
import { prisma } from "@/lib/prisma";
import { getUploadTasks } from "@/lib/workflow/processes";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/**
 * My Tasks: everything waiting for this person.
 *  - Document upload: running processes whose next document this person may upload (they pick the branch).
 *  - Document review: documents waiting for their approval, on hold, or sent back to them for revision.
 */
export default async function MyTasksPage() {
  const session = await requireAuth();
  const user = { userId: session.userId, userType: session.userType };

  const [uploadTasks, reviewDocuments, canBulkApprove] = await Promise.all([
    getUploadTasks(prisma, user),
    getActionableDocuments(user, [DocumentStatus.PENDING, DocumentStatus.ON_HOLD, DocumentStatus.REVISION_REQUIRED]),
    userCanBulkApprove(session.userId),
  ]);

  return (
    <DashboardShell
      role={session.userType}
      userName={session.name}
      title="My Tasks"
      subtitle={`${uploadTasks.length} to upload · ${reviewDocuments.length} to review`}
    >
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Document upload</h3>
            <p className="mt-1 text-sm text-slate-500">
              Processes waiting for their next document. Choose the document to upload and the process follows that path.
            </p>
          </div>
          <Link href="/processes" className="text-sm font-medium text-cyan-700 hover:underline">View all process runs</Link>
        </div>

        {uploadTasks.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">No documents are waiting for you to upload.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Process</th>
                  <th className="px-5 py-3 font-semibold">Project</th>
                  <th className="px-5 py-3 font-semibold">Last approved</th>
                  <th className="px-5 py-3 font-semibold">Next document (choose one)</th>
                  <th className="px-5 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {uploadTasks.map((task) => (
                  <tr key={task.runId} className="border-t border-slate-100 align-top hover:bg-slate-50/50">
                    <td className="px-5 py-4">
                      <Link href={`/processes/${task.runId}`} className="font-medium text-slate-900 hover:text-indigo-600 hover:underline">
                        {task.processName}
                      </Link>
                      {task.reference ? <div className="text-xs text-slate-500">{task.reference}</div> : null}
                    </td>
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
        <div className="px-1 py-4">
          <ApproverPendingTable
            emptyMessage="No documents are waiting for your review."
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
