import Link from "next/link";
import { DocumentStatus, ErrProjectCountry, ErrStage, ErrStatus, ErrType, UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import DocumentStatusFilter from "@/components/document-status-filter";
import StatusBadge from "@/components/status-badge";
import { canViewErrQuotation, getErrVisibilityWhere, requireErrAccess } from "@/lib/err/permissions";
import { prisma } from "@/lib/prisma";
import ErrSummaryCards from "@/components/err-summary-cards";
import {
  getErrCounts,
  getErrViewWhere,
  type ErrView,
} from "@/lib/err/queries";
import {
  ERR_STATUS_FILTER_OPTIONS,
  parseErrStatusFilter,
  parseErrTypeFilter,
} from "@/lib/document-status";
import { isErrUploaderAccount } from "@/lib/err/uploader-access";
import ErrListTable from "@/components/err-list-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const stageLabels: Record<ErrStage, string> = {
  PROJECT_DIRECTOR: "Project Director",
  PMV_MANAGER: "PMV Manager",
  ACTING_CEO: "Managing Director",
  CEO: "CEO",
};

const typeLabels: Record<ErrType, string> = {
  RENTAL_ACTC: "Rental ACTC",
  RENTAL_EXTERNAL: "Rental External",
  RENEWAL: "Renewal",
  PURCHASE: "Purchase",
};

const statusLabels: Record<ErrStatus, string> = {
  PENDING: "Pending",
  ON_HOLD: "On Hold",
  REVISION_REQUIRED: "Revision Required",
  REJECTED: "Rejected",
  APPROVED: "Approved",
};

function getStatusLabel(status: ErrStatus, stage: ErrStage) {
  if (status === "PENDING") {
    return `Pending ${stageLabels[stage]}`;
  }

  if (status === "ON_HOLD") {
    return `On Hold — ${stageLabels[stage]}`;
  }

  return statusLabels[status];
}

function getErrDisplayNumber(documentNumber: string) {
  return `ERR ${documentNumber.slice(-6).toUpperCase()}`;
}

const viewLabels: Record<ErrView, string> = {
  all: "All ERRs",
  pending: "Pending Approvals",
  "on-hold": "On Hold",
  approved: "Approved",
  rejected: "Rejected",
  "revision-required": "Revision Required",
};

function getListUrl(
  view: ErrView,
  page: number,
  filters: { search?: string | string[]; status?: string | string[]; errType?: string | string[]; section?: string | string[]; country?: string | string[]; projectId?: string | string[] },
) {
  const params = new URLSearchParams({
    view,
    page: String(page),
  });
  for (const key of ["search", "status", "errType", "section", "country", "projectId"] as const) {
    const value = filters[key];
    if (typeof value === "string" && value) params.set(key, value);
  }

  return `/errs?${params.toString()}`;
}

type PageProps = {
  searchParams: Promise<{
    view?: string | string[];
    page?: string | string[];
    status?: string | string[];
    errType?: string | string[];
    section?: string | string[];
    search?: string | string[];
    country?: string | string[];
    projectId?: string | string[];
  }>;
};

export default async function ErrPage({ searchParams }: PageProps) {
  const access = await requireErrAccess();

  const params = await searchParams;

    const view: ErrView =
    typeof params.view === "string" &&
    Object.prototype.hasOwnProperty.call(viewLabels, params.view)
      ? (params.view as ErrView)
      : "all";

  const personal =
    !access.isAdmin && !access.isUploader && !access.isViewer;

  const counts = await getErrCounts(access);

  const countsByView: Record<ErrView, number> = {
    all: counts.all,
    pending: counts.pending,
    "on-hold": counts.onHold,
    approved: counts.approved,
    rejected: counts.rejected,
    "revision-required": counts.revisionRequired,
  };

  const heading = params.section === "dashboard"
    ? "Dashboard"
    : params.section === "my-documents"
      ? "My Documents"
      : view === "all"
        ? "ERRs"
        : viewLabels[view];

  const statusFilter = parseErrStatusFilter(params.status);
  const errTypeFilter = parseErrTypeFilter(params.errType);
  const searchQuery = typeof params.search === "string" ? params.search.trim() : "";
  const canSeeAllErrs = access.isAdmin || access.isWorkshopManager || access.isPmvManager || access.isGlobalUploader || access.isGlobalViewer;
  const errVisibilityWhere = getErrVisibilityWhere(access);
  const errProjects = await prisma.errProject.findMany({
    where: {
      ...(canSeeAllErrs ? {} : { errs: { some: errVisibilityWhere } }),
    },
    select: { id: true, name: true, country: true },
    orderBy: [{ country: "asc" }, { name: "asc" }],
  });
  const accessibleCountries = canSeeAllErrs
    ? [ErrProjectCountry.KUWAIT, ErrProjectCountry.KSA]
    : Array.from(new Set(errProjects.map((project) => project.country)));
  const requestedCountry = params.country === "KSA" || params.country === "KUWAIT"
    ? params.country as ErrProjectCountry
    : "";
  const countryFilter = accessibleCountries.includes(requestedCountry as ErrProjectCountry) ? requestedCountry : "";
  const projectsForCountry = errProjects.filter((project) => !countryFilter || project.country === countryFilter);
  const selectedProject = projectsForCountry.find((project) => project.id === params.projectId);
  const showCountryFilter = canSeeAllErrs || accessibleCountries.length > 1;
  const isDashboardView = params.section === "dashboard";
  const listView: ErrView = isDashboardView ? "pending" : view;

  const requestedPage =
    typeof params.page === "string" && /^\d+$/.test(params.page)
      ? Number(params.page)
      : 1;

  const safePage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;

  const baseWhere = getErrViewWhere(access, listView);
  const statusClause = !isDashboardView && statusFilter ? { status: statusFilter } : {};
  const errTypeClause = !isDashboardView && errTypeFilter ? { type: errTypeFilter } : {};
  const searchClause = searchQuery
    ? { title: { contains: searchQuery, mode: "insensitive" as const } }
    : {};

  const where = {
    AND: [
      baseWhere,
      statusClause,
      errTypeClause,
      searchClause,
      countryFilter ? { project: { country: countryFilter } } : {},
      selectedProject ? { projectId: selectedProject.id } : {},
    ],
  };
  const total = await prisma.err.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(safePage, totalPages);

  const errs = await prisma.err.findMany({
    where,
    select: {
      id: true,
      documentNumber: true,
      title: true,
      type: true,
      status: true,
      currentStage: true,
      currentApproverId: true,
      createdAt: true,
      downloadRecords: { where: { userId: access.userId }, select: { downloadedAt: true }, take: 1 },
      files: {
        where: { kind: "QUOTATION" },
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { originalName: true },
      },
      projectDirector: {
        select: {
          name: true,
        },
      },
      currentApprover: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const isUploaderUser = access.isUploader || isErrUploaderAccount(access.name, access.role);
  const isReadyMixDirector = access.email.trim().toLowerCase() === "elie.azzam@ahmadiah.com";
  const readyMixDocuments = isReadyMixDirector
    ? await prisma.document.findMany({
        where: {
          currentApproverId: access.userId,
          documentType: { in: ["MATERIAL_REQUISITION", "COMPARISON"] },
          projectName: "Ready Mix Khobar",
          status: DocumentStatus.PENDING_APPROVER_1,
          createdBy: { email: "dispatcher.pmv@ahmadiah.com" },
        },
        select: {
          id: true,
          documentNumber: true,
          title: true,
          documentType: true,
          comparisonType: true,
          status: true,
          mrNumber: true,
          mrType: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <DashboardShell
      role={access.role}
      userName={access.name}
      userEmail={access.email}
      title={heading}
      subtitle="ERR workflow queue"
      isUploader={isUploaderUser}
    >
      {isDashboardView ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">ERR Dashboard</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Welcome, {access.name}</h2>
            <p className="mt-1 text-sm text-slate-600">Monitor ERR submissions, approvals, and workflow status.</p>
          </div>
          {isUploaderUser ? (
            <Link href="/new-document" className="inline-flex rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
              Upload New Document
            </Link>
          ) : null}
        </div>
      ) : null}
      <ErrSummaryCards counts={counts} personal={personal} />
      {isDashboardView && isReadyMixDirector ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">Ready Mix Khobar Documents</h2>
            <p className="mt-1 text-sm text-slate-500">Material requisitions and comparison sheets awaiting your Project Director review.</p>
          </div>
          {readyMixDocuments.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No Ready Mix Khobar documents are waiting for your review.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Document</th>
                    <th className="px-5 py-3 font-semibold">Type</th>
                    <th className="px-5 py-3 font-semibold">MR Number</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Submitted</th>
                    <th className="px-5 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {readyMixDocuments.map((document) => (
                    <tr key={document.id} className="border-t border-slate-100">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-900">{document.documentNumber}</p>
                        <p className="text-slate-500">{document.title}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-700">
                        {document.documentType === "COMPARISON"
                          ? document.comparisonType === "SPARE_PARTS" ? "Spare Parts Comparison" : "Comparison Sheet"
                          : "Material Requisition"}
                      </td>
                      <td className="px-5 py-4 text-slate-700">{document.mrNumber || "—"}</td>
                      <td className="px-5 py-4"><StatusBadge status={document.status} label="Pending Project Director" /></td>
                      <td className="px-5 py-4 text-slate-500">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(document.createdAt)}</td>
                      <td className="px-5 py-4">
                        <Link href={`/approver/review/${document.id}`} className="font-semibold text-cyan-700 hover:underline">Review</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{heading}</h3>
            </div>
          </div>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            value={statusFilter}
            documentType="ERR"
            errType={errTypeFilter}
            showErrTypeFilter={!isDashboardView}
            showStatusFilter={!isDashboardView}
            statusFilterOptions={ERR_STATUS_FILTER_OPTIONS}
            title="Status"
            errCountry={countryFilter}
            errCountries={accessibleCountries}
            showErrCountryFilter={showCountryFilter}
            errProjectId={selectedProject?.id ?? ""}
            errProjects={projectsForCountry}
            showErrScopeFilters
            showErrProjectFilter={canSeeAllErrs}
            gridLayout
            hiddenFields={{
              ...(typeof params.view === "string" ? { view: params.view } : {}),
              ...(typeof params.section === "string" ? { section: params.section } : {}),
              ...(typeof params.search === "string" ? { search: params.search } : {}),
            }}
          />
        </div>

        <ErrListTable
          errs={errs.map((err) => ({
            ...err,
            downloadedAt: err.downloadRecords[0]?.downloadedAt ?? null,
            createdAt: err.createdAt.toISOString(),
          }))}
          userId={access.userId}
          canDelete={access.isAdmin}
          canRequestDeletion={access.isUploader}
          showQuotation={canViewErrQuotation(access)}
        />

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <p className="text-sm text-slate-500">
            Page {page} of {totalPages}
          </p>

          <div className="flex gap-3 text-sm font-medium">
            {page > 1 && (
              <Link
                href={getListUrl(view, page - 1, params)}
                className="text-slate-700 hover:underline"
              >
                Previous
              </Link>
            )}

            {page < totalPages && (
              <Link
                href={getListUrl(view, page + 1, params)}
                className="text-slate-700 hover:underline"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}