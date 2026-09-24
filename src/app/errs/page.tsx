import Link from "next/link";
import { ErrStage, ErrStatus, ErrType, UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import DocumentStatusFilter from "@/components/document-status-filter";
import StatusBadge from "@/components/status-badge";
import { requireErrAccess } from "@/lib/err/permissions";
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
  ACTING_CEO: "Acting CEO",
  CEO: "CEO",
};

const typeLabels: Record<ErrType, string> = {
  RENTAL_ACTC: "Rental ACTC",
  RENTAL_EXTERNAL: "Rental External",
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

function getListUrl(view: ErrView, page: number) {
  const params = new URLSearchParams({
    view,
    page: String(page),
  });

  return `/errs?${params.toString()}`;
}

type PageProps = {
  searchParams: Promise<{
    view?: string | string[];
    page?: string | string[];
    status?: string | string[];
    errType?: string | string[];
    section?: string | string[];
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

  const where = {
    AND: [baseWhere, statusClause, errTypeClause],
  };
  const total = countsByView[listView];
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

  return (
    <DashboardShell
      role={access.role}
      userName={access.name}
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
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{heading}</h3>
            </div>
          </div>
        </div>
        {!isDashboardView ? <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            value={statusFilter}
            documentType="ERR"
            errType={errTypeFilter}
            showErrTypeFilter
            showStatusFilter
            statusFilterOptions={ERR_STATUS_FILTER_OPTIONS}
            title="Status"
          />
        </div> : null}

        <ErrListTable
          errs={errs.map((err) => ({ ...err, createdAt: err.createdAt.toISOString() }))}
          userId={access.userId}
          canDelete={access.isAdmin}
          canRequestDeletion={access.isUploader}
          showQuotation={access.isUploader || access.isAdmin || access.isPmvManager || access.isActingCeo || access.isCeo}
        />

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
          <p className="text-sm text-slate-500">
            Page {page} of {totalPages}
          </p>

          <div className="flex gap-3 text-sm font-medium">
            {page > 1 && (
              <Link
                href={getListUrl(view, page - 1)}
                className="text-slate-700 hover:underline"
              >
                Previous
              </Link>
            )}

            {page < totalPages && (
              <Link
                href={getListUrl(view, page + 1)}
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