import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, FileCheck, FileText, FolderCheck } from "lucide-react";
import DashboardShell from "@/components/dashboard-shell";
import StatusBadge from "@/components/status-badge";
import ErrVoucherModal from "@/components/err-voucher-modal";
import {
  canApproveErr,
  canUploadErrVoucher,
  getErrVisibilityWhere,
  requireErrAccess,
} from "@/lib/err/permissions";
import { isRentalErr } from "@/lib/err/vouchers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

const stageLabels = {
  PROJECT_DIRECTOR: "Project Director",
  PMV_MANAGER: "PMV Manager",
  ACTING_CEO: "Acting CEO",
  CEO: "CEO",
};

const typeLabels = {
  RENTAL_ACTC: "Rental ACTC",
  RENTAL_EXTERNAL: "Rental External",
  PURCHASE: "Purchase",
};

const statusLabels = {
  PENDING: "Pending",
  ON_HOLD: "On Hold",
  REVISION_REQUIRED: "Revision Required",
  REJECTED: "Rejected",
  APPROVED: "Approved",
};

const actionLabels: Record<string, string> = {
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  FINALIZED_APPROVAL: "Finalized approval",
  ESCALATED_TO_ACTING_CEO: "Sent to Acting CEO",
  ESCALATED_TO_CEO: "Sent to CEO",
  REJECTED: "Rejected",
  REQUESTED_REVISION: "Requested revision",
  PUT_ON_HOLD: "Put on hold",
  RESUMED: "Resumed",
  RESUBMITTED: "Resubmitted",
  COMMENTED: "Commented",
  RELEASE_VOUCHER_ADDED: "Release voucher added & merged",
  RECEIPT_VOUCHER_ADDED: "Receipt voucher added & merged",
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(date);
}

export default async function ErrDetailsPage({ params }: Props) {
  const access = await requireErrAccess();
  const { id } = await params;

  const err = await prisma.err.findFirst({
    where: {
      AND: [
        { id },
        getErrVisibilityWhere(access),
      ],
    },
    select: {
      documentNumber: true,
      title: true,
      description: true,
      type: true,
      status: true,
      currentStage: true,
      projectId: true,
      revisionNumber: true,
      projectNameSnapshot: true,
      createdAt: true,
      approvedAt: true,
      currentApproverAssignedAt: true,
      createdBy: {
        select: { name: true },
      },
      projectDirector: {
        select: { name: true },
      },
      currentApprover: {
        select: { name: true },
      },
      files: {
        orderBy: [
          { kind: "asc" },
          { versionNumber: "desc" },
        ],
        select: {
          id: true,
          kind: true,
          originalName: true,
          versionNumber: true,
          fileSize: true,
          createdAt: true,
        },
      },
      approvalHistory: {
        select: {
          id: true,
          action: true,
          stage: true,
          comments: true,
          performedAt: true,
          revisionNumber: true,
          performedBy: {
            select: { name: true },
          },
        },
        orderBy: [
          { performedAt: "desc" },
          { id: "desc" },
        ],
        take: 50,
      },
    },
  });

  if (!err) {
    notFound();
  }

  const statusText =
    err.status === "PENDING"
      ? `Pending ${stageLabels[err.currentStage]}`
      : err.status === "ON_HOLD"
        ? `On Hold — ${stageLabels[err.currentStage]}`
        : statusLabels[err.status];

  const latestComment = err.approvalHistory.find((item) => item.comments)?.comments || null;
  const canReview = await canApproveErr(access, id);

  const isRental = isRentalErr(err.type);
  const isApproved = err.status === "APPROVED";
  const releaseVoucherFile = err.files.find((f) => f.kind === "RELEASE_VOUCHER");
  const receiptVoucherFile = err.files.find((f) => f.kind === "RECEIPT_VOUCHER");
  const hasReleaseVoucher = Boolean(releaseVoucherFile);
  const hasReceiptVoucher = Boolean(receiptVoucherFile);
  const canUploadVouchers = canUploadErrVoucher(access, err.projectId);

  const visibleFiles = err.files.filter((file) => {
    if (file.kind === "QUOTATION") {
      return access.isUploader || access.isAdmin || access.isPmvManager;
    }
    if (file.kind === "RELEASE_VOUCHER" || file.kind === "RECEIPT_VOUCHER") {
      return true;
    }
    return false;
  });

  return (
    <DashboardShell
      role={access.role}
      userName={access.name}
      title="ERR Details"
      subtitle="Review workflow history, status, and uploaded versions"
      isUploader={access.isUploader}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/errs"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to ERRs
        </Link>

        <a
          href={`/api/errs/${id}/download?kind=ERR_PDF`}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download className="h-4 w-4" />
          Download current file
        </a>

        <a
          href={`/api/errs/${id}/download?kind=ERR_PDF`}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100"
          target="_blank"
          rel="noopener noreferrer"
        >
          <FileText className="h-4 w-4" />
          Open File
        </a>

        {isRental && isApproved && !hasReleaseVoucher && (
          <ErrVoucherModal
            errId={id}
            voucherType="RELEASE_VOUCHER"
            buttonLabel="Add Release Voucher"
            canUpload={canUploadVouchers}
          />
        )}

        {isRental && isApproved && hasReleaseVoucher && !hasReceiptVoucher && (
          <ErrVoucherModal
            errId={id}
            voucherType="RECEIPT_VOUCHER"
            buttonLabel="Add Receipt Voucher"
            canUpload={canUploadVouchers}
          />
        )}

        {canReview && (
          <Link
            href={`/errs/${id}/review`}
            className="inline-flex rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Review ERR
          </Link>
        )}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              ERR overview
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">
              {err.documentNumber}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{err.title}</p>
          </div>

          <StatusBadge status={err.status} label={statusText} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Type</span>
                <span className="font-semibold text-slate-900">{typeLabels[err.type]}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Project</span>
                <span className="font-semibold text-slate-900">{err.projectNameSnapshot || "Not recorded"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Submitted by</span>
                <span className="font-semibold text-slate-900">{err.createdBy.name}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Project director</span>
                <span className="font-semibold text-slate-900">{err.projectDirector.name}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Revision</span>
                <span className="font-semibold text-slate-900">{String(err.revisionNumber)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Created</span>
                <span className="font-semibold text-slate-900">{formatDate(err.createdAt)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Current approver</span>
                <span className="font-semibold text-slate-900">{err.currentApprover?.name ?? "Unassigned"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Assigned at</span>
                <span className="font-semibold text-slate-900">{err.currentApproverAssignedAt ? formatDate(err.currentApproverAssignedAt) : "Not assigned yet"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Finally approved</span>
                <span className="font-semibold text-slate-900">{err.approvedAt ? formatDate(err.approvedAt) : "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Latest comment</span>
                <span className="font-semibold text-slate-900">{latestComment || "No comments yet"}</span>
              </div>
            </div>
          </div>
        </div>

        {err.description && (
          <div className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold text-slate-700">
              Description
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">
              {err.description}
            </p>
          </div>
        )}
      </section>

      {isRental && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                Rental Workflow
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                Vouchers & Package Merging Pipeline
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {isApproved && !hasReleaseVoucher && (
                <ErrVoucherModal
                  errId={id}
                  voucherType="RELEASE_VOUCHER"
                  buttonLabel="Add Release Voucher"
                  canUpload={canUploadVouchers}
                />
              )}
              {isApproved && hasReleaseVoucher && !hasReceiptVoucher && (
                <ErrVoucherModal
                  errId={id}
                  voucherType="RECEIPT_VOUCHER"
                  buttonLabel="Add Receipt Voucher"
                  canUpload={canUploadVouchers}
                />
              )}
              {isApproved && hasReleaseVoucher && hasReceiptVoucher && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  All Vouchers Completed
                </span>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Step 1: Approved ERR */}
            <div
              className={`rounded-2xl p-4 ring-1 ${
                isApproved
                  ? "bg-emerald-50/60 ring-emerald-200"
                  : "bg-slate-50 ring-slate-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Step 1
                </span>
                {isApproved ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Approved
                  </span>
                ) : (
                  <span className="text-xs font-medium text-amber-600">Pending Approval</span>
                )}
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-900">ERR Approval</h3>
              <p className="mt-1 text-xs text-slate-600">
                {isApproved && err.approvedAt
                  ? `Approved on ${formatDate(err.approvedAt)}`
                  : "Requires full PMV approval"}
              </p>
            </div>

            {/* Step 2: Release Voucher */}
            <div
              className={`rounded-2xl p-4 ring-1 ${
                hasReleaseVoucher
                  ? "bg-sky-50/60 ring-sky-200"
                  : isApproved
                  ? "bg-amber-50/40 ring-amber-200"
                  : "bg-slate-50 ring-slate-200 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Step 2
                </span>
                {hasReleaseVoucher ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-700">
                    <CheckCircle2 className="h-4 w-4" /> Merged in ERR+Release
                  </span>
                ) : isApproved ? (
                  <span className="text-xs font-medium text-amber-600">Awaiting Upload</span>
                ) : (
                  <span className="text-xs text-slate-400">Locked</span>
                )}
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-900">Release Voucher</h3>
              <p className="mt-1 text-xs text-slate-600">
                {hasReleaseVoucher
                  ? `Merged: ${releaseVoucherFile?.originalName}`
                  : isApproved
                  ? "Upload to generate ERR+Release package"
                  : "Available after ERR approval"}
              </p>
              {isApproved && !hasReleaseVoucher && (
                <div className="mt-3">
                  <ErrVoucherModal
                    errId={id}
                    voucherType="RELEASE_VOUCHER"
                    buttonLabel="Upload Release Voucher"
                    canUpload={canUploadVouchers}
                  />
                </div>
              )}
            </div>

            {/* Step 3: Receipt Voucher */}
            <div
              className={`rounded-2xl p-4 ring-1 ${
                hasReceiptVoucher
                  ? "bg-emerald-50/60 ring-emerald-200"
                  : hasReleaseVoucher
                  ? "bg-amber-50/40 ring-amber-200"
                  : "bg-slate-50 ring-slate-200 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Step 3
                </span>
                {hasReceiptVoucher ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Final in ERR+Release+Receipt
                  </span>
                ) : hasReleaseVoucher ? (
                  <span className="text-xs font-medium text-amber-600">Awaiting Upload</span>
                ) : (
                  <span className="text-xs text-slate-400">Locked</span>
                )}
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-900">Receipt Voucher</h3>
              <p className="mt-1 text-xs text-slate-600">
                {hasReceiptVoucher
                  ? `Merged: ${receiptVoucherFile?.originalName}`
                  : hasReleaseVoucher
                  ? "Upload to finalize package"
                  : "Available after Release Voucher"}
              </p>
              {hasReleaseVoucher && !hasReceiptVoucher && (
                <div className="mt-3">
                  <ErrVoucherModal
                    errId={id}
                    voucherType="RECEIPT_VOUCHER"
                    buttonLabel="Upload Receipt Voucher"
                    canUpload={canUploadVouchers}
                  />
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            Attachments & Linked Files
          </h2>
        </div>

        {visibleFiles.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No attachments available.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {visibleFiles.map((file) => {
              const kindLabel =
                file.kind === "QUOTATION"
                  ? "Quotation"
                  : file.kind === "RELEASE_VOUCHER"
                  ? "Release Voucher"
                  : file.kind === "RECEIPT_VOUCHER"
                  ? "Receipt Voucher"
                  : "Attachment";

              const badgeColor =
                file.kind === "RELEASE_VOUCHER"
                  ? "bg-sky-50 text-sky-700 ring-sky-200"
                  : file.kind === "RECEIPT_VOUCHER"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-slate-100 text-slate-700 ring-slate-200";

              return (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${badgeColor}`}
                    >
                      {kindLabel}
                    </span>
                    <span className="truncate font-medium text-slate-700">
                      {file.originalName}
                    </span>
                  </div>
                  <a
                    href={`/api/errs/${id}/download?kind=${file.kind}&fileId=${file.id}`}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Approval History and Comments
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Latest 50 actions, newest first.
        </p>

        {err.approvalHistory.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No actions recorded.
          </p>
        ) : (
          <ol className="mt-5 space-y-4">
            {err.approvalHistory.map((event) => (
              <li
                key={event.id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <p className="text-sm font-semibold text-slate-900">
                  {actionLabels[event.action]} — {event.performedBy.name}
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  {event.stage ? `${stageLabels[event.stage]} · ` : ""}
                  Revision {event.revisionNumber} ·{" "}
                  {formatDate(event.performedAt)}
                </p>

                {event.comments && (
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">
                    {event.comments}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </DashboardShell>
  );
}