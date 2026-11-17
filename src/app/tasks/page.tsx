// src/app/tasks/page.tsx
import Link from "next/link";
import { DocumentStatus } from "@prisma/client";
import ApproverPendingTable from "@/components/approver-pending-table";
import UploadTaskSections, { type UploadTaskSection } from "@/components/upload-task-sections";
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
import { appConfig } from "@/lib/env";
import { USER_TYPE } from "@/lib/auth/roles";
import { getTaskOnlyChecker, getUploadTasks } from "@/lib/workflow/processes";
import { createEligiblePeopleFinder } from "@/lib/workflow/eligible-people";
import { getVisibleReferenceSummaries, userCanViewReferences } from "@/lib/auth/access";

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

// Filters can hold several values (?rv_documentType=MR&rv_documentType=PO), so values stay lists.
function withoutPrefix(params: NonNullable<ListSearchParams>, prefix: string): NonNullable<ListSearchParams> {
  const result: NonNullable<ListSearchParams> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(prefix)) continue;
    result[key.slice(prefix.length)] = value;
  }
  return result;
}

function onlyPrefix(params: NonNullable<ListSearchParams>, prefix: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(prefix) || value === undefined) continue;
    result[key] = value;
  }
  return result;
}

type TaskTab = "review" | "upload";

// The address of this page with some fields changed (undefined removes a field); every other filter is kept.
function hrefWith(params: NonNullable<ListSearchParams>, patch: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key in patch || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) query.set(key, value);
  }
  const text = query.toString();
  return text ? `/tasks?${text}` : "/tasks";
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

  const [allUploadTasks, allReviewDocuments, canBulkApprove, { documentTypes, projects, locations }, isTaskOnly] = await Promise.all([
    getUploadTasks(prisma, user, { since: appConfig.emailPendingSince() }),
    getActionableDocuments(user, [DocumentStatus.PENDING, DocumentStatus.ON_HOLD, DocumentStatus.REVISION_REQUIRED]),
    userCanBulkApprove(session.userId),
    loadFilterOptions(),
    getTaskOnlyChecker(prisma),
  ]);

  // Same filters as the document lists. Download status is per person (documents are usually downloaded before they are approved or rejected).
  const trackedReview = await withDownloadTracking(allReviewDocuments, session.userId);
  const reviewDocuments = applyListFilters(trackedReview, reviewFilters);
  const uploadTasks = allUploadTasks.filter((task) => {
    if (uploadFilters.documentType.length > 0 && !task.options.some((option) => uploadFilters.documentType.includes(option.typeCode))) return false;
    if (uploadFilters.documentSubtype.length > 0 && !task.options.some((option) => option.subtypeCode !== null && uploadFilters.documentSubtype.includes(option.subtypeCode))) return false;
    if (uploadFilters.project.length > 0 && !(task.project && uploadFilters.project.includes(task.project.id))) return false;
    if (uploadFilters.location.length > 0 && !(task.project?.locationId && uploadFilters.location.includes(task.project.locationId))) return false;
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

  // Admin only: who may upload each awaited document (same rules as a real upload). One finder serves every row.
  const uploadersByKey = new Map<string, Awaited<ReturnType<Awaited<ReturnType<typeof createEligiblePeopleFinder>>["uploaders"]>>>();
  if (isAdmin && uploadTasks.length > 0) {
    const finder = await createEligiblePeopleFinder(prisma);
    for (const task of uploadTasks) {
      for (const option of task.options) {
        uploadersByKey.set(`${task.runId}|${option.stepId}`, await finder.uploaders({ documentTypeId: option.documentTypeId, documentSubtypeId: option.documentSubtypeId, projectId: task.project?.id ?? null }));
      }
    }
  }

  // ---- Upload tasks grouped by the sub type they wait for ----
  // A run that could continue with several documents appears in the group of each of them (with the others named), and
  // "Upload" there goes straight to that document. A type / sub type filter also narrows which groups are shown.
  const sectionMap = new Map<string, UploadTaskSection>();
  for (const task of uploadTasks) {
    for (const option of task.options) {
      if (uploadFilters.documentType.length > 0 && !uploadFilters.documentType.includes(option.typeCode)) continue;
      if (uploadFilters.documentSubtype.length > 0 && !(option.subtypeCode && uploadFilters.documentSubtype.includes(option.subtypeCode))) continue;
      const scopeKey = `${option.documentTypeId}|${option.documentSubtypeId ?? ""}`;
      const label = `${option.typeName}${option.subtypeName ? ` - ${option.subtypeName}` : ""}`;
      let section = sectionMap.get(scopeKey);
      if (!section) {
        const bulkQuery = new URLSearchParams({ bulkTypeId: option.documentTypeId });
        if (option.documentSubtypeId) bulkQuery.set("bulkSubtypeId", option.documentSubtypeId);
        const canLinkByName = isTaskOnly({ documentTypeId: option.documentTypeId, documentSubtypeId: option.documentSubtypeId });
        section = { key: scopeKey.replace(/[^a-zA-Z0-9_-]/g, "-"), label, rows: [], bulkHref: canLinkByName ? `/new-document?${bulkQuery.toString()}` : null };
        sectionMap.set(scopeKey, section);
      }
      section.rows.push({
        runId: task.runId,
        awaiting: [
          {
            stepId: option.stepId,
            name: option.name,
            typeLabel: label,
            uploaders: uploadersByKey.get(`${task.runId}|${option.stepId}`) ?? [],
            waitingNote: option.waitingUntil ? `waiting period until ${dateTimeFormat.format(option.waitingUntil)} (Admin can upload now)` : null,
          },
        ],
        alternatives: task.options.filter((other) => other.stepId !== option.stepId).map((other) => other.name),
        uploadHref: `/new-document?processInstanceId=${task.runId}&processStepId=${option.stepId}`,
        linked: task.lastDocument ? { id: task.lastDocument.id, documentNumber: task.lastDocument.documentNumber, title: task.lastDocument.title } : null,
        dateLabel: task.lastDocument?.approvedAt ? dateFormat.format(task.lastDocument.approvedAt) : "—",
        projectLabel: task.project ? `${task.project.code} - ${task.project.name}` : "—",
      });
    }
  }
  const uploadSections: UploadTaskSection[] = [...sectionMap.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((section) => ({ ...section, bulkHref: section.rows.length > 1 ? section.bulkHref : null }));

  // One list at a time: the tab in the address wins, otherwise the review list when there is anything to review.
  const requestedTab = typeof params.tab === "string" ? params.tab : Array.isArray(params.tab) ? params.tab[0] : undefined;
  const tab: TaskTab =
    requestedTab === "upload" || requestedTab === "review"
      ? requestedTab
      : allReviewDocuments.length === 0 && allUploadTasks.length > 0
        ? "upload"
        : "review";
  const statusCounts = REVIEW_STATUS_OPTIONS.map((option) => ({
    ...option,
    count: allReviewDocuments.filter((row) => row.status === option.value).length,
  }));
  const activeStatuses: string[] = reviewFilters.status;

  // Reference documents attached to the documents waiting for review (only for people who may view them).
  const showReferences = await userCanViewReferences(user);
  const referenceSummaries = showReferences ? await getVisibleReferenceSummaries(user, reviewDocuments.map((row) => row.id)) : new Map();

  return (
    <DashboardShell
      role={session.userType}
      userName={session.name}
      title="My Tasks"
      subtitle={`${allUploadTasks.length} to upload · ${allReviewDocuments.length} to review`}
    >
      {allUploadTasks.length === 0 && allReviewDocuments.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">Nothing is waiting for you right now.</section>
      ) : null}

      {allUploadTasks.length > 0 || allReviewDocuments.length > 0 ? (
        <nav className="flex flex-wrap gap-2" aria-label="Task lists">
          {([
            { value: "review", label: "To review", count: allReviewDocuments.length },
            { value: "upload", label: "To upload", count: allUploadTasks.length },
          ] as const).map((item) => {
            const active = tab === item.value;
            return (
              <Link
                key={item.value}
                href={hrefWith(params, { tab: item.value })}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-sm transition ${
                  active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {item.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"}`}>{item.count}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {tab === "upload" && allUploadTasks.length === 0 && allReviewDocuments.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">No documents are waiting for you to upload.</section>
      ) : null}
      {tab === "review" && allReviewDocuments.length === 0 && allUploadTasks.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">No documents are waiting for your review.</section>
      ) : null}

      {tab === "upload" && allUploadTasks.length > 0 ? (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Document upload</h3>
            <p className="mt-1 text-sm text-slate-500">
              Grouped by the document they wait for. Upload one at a time, or use “Upload several” to drop many files of one kind at once: each is linked to its task by its name.
            </p>
          </div>
          {isAdmin ? <Link href="/processes" className="text-sm font-medium text-cyan-700 hover:underline">View all process runs</Link> : null}
        </div>

        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            fieldPrefix={UPLOAD_PREFIX}
            preserve={{ ...onlyPrefix(params, REVIEW_PREFIX), tab: "upload" }}
            documentType={uploadFilters.documentType}
            documentSubtype={uploadFilters.documentSubtype}
            project={uploadFilters.project}
            location={uploadFilters.location}
            search={uploadFilters.search}
            showStatusFilter={false}
            documentTypes={documentTypes}
            projects={projects}
            locations={locations}
          />
        </div>

        {uploadSections.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">{allUploadTasks.length === 0 ? "No documents are waiting for you to upload." : "No upload tasks match these filters."}</div>
        ) : (
          <UploadTaskSections showWhoCanUpload={isAdmin} sections={uploadSections} />
        )}
      </section>
      ) : null}

      {tab === "review" && allReviewDocuments.length > 0 ? (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Document review</h3>
            <p className="mt-1 text-sm text-slate-500">Documents waiting for your approval, on hold, or sent back to you for revision.</p>
          </div>
          {/* Quick status filter: one click narrows the list; the other filters are kept. */}
          <div className="flex flex-wrap gap-2">
            <Link
              href={hrefWith(params, { [`${REVIEW_PREFIX}status`]: undefined, tab: "review" })}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${activeStatuses.length === 0 ? "border-cyan-300 bg-cyan-50 text-cyan-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              All <span className="ml-1 text-slate-500">{allReviewDocuments.length}</span>
            </Link>
            {statusCounts.filter((item) => item.count > 0).map((item) => {
              const active = activeStatuses.length === 1 && activeStatuses[0] === item.value;
              return (
                <Link
                  key={item.value}
                  href={hrefWith(params, { [`${REVIEW_PREFIX}status`]: active ? undefined : item.value, tab: "review" })}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-cyan-300 bg-cyan-50 text-cyan-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                >
                  {item.label} <span className="ml-1 text-slate-500">{item.count}</span>
                </Link>
              );
            })}
          </div>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            fieldPrefix={REVIEW_PREFIX}
            preserve={{ ...onlyPrefix(params, UPLOAD_PREFIX), tab: "review" }}
            value={reviewFilters.status}
            documentType={reviewFilters.documentType}
            documentSubtype={reviewFilters.documentSubtype}
            project={reviewFilters.project}
            location={reviewFilters.location}
            downloadStatus={reviewFilters.downloadStatus}
            search={reviewFilters.search}
            showDownloadFilters
            showApprovalDateFilters={false}
            statusFilterOptions={REVIEW_STATUS_OPTIONS}
            documentTypes={documentTypes}
            projects={projects}
            locations={locations}
          />
        </div>
        <div className="px-1 py-4">
          <ApproverPendingTable
            showVersion={isAdmin}
            showReferences={showReferences}
            emptyMessage={allReviewDocuments.length === 0 ? "No documents are waiting for your review." : "No documents match these filters."}
            allowBatch={canBulkApprove}
            documents={reviewDocuments.map((row) => ({
              id: row.id,
              documentNumber: row.documentNumber,
              title: row.title,
              projectLabel: row.project ? `${row.project.code} - ${row.project.name}` : null,
              documentTypeLabel: `${row.documentType.name}${row.documentSubtype ? ` - ${row.documentSubtype.name}` : ""}`,
              statusLabel: row.statusLabel,
              currentVersion: row.currentVersion,
              latestComment: row.latestComment,
              uploadedAt: dateFormat.format(row.createdAt),
              batchEligible: row.status === DocumentStatus.PENDING,
              references: referenceSummaries.get(row.id) ?? [],
            }))}
          />
        </div>
      </section>
      ) : null}
    </DashboardShell>
  );
}
