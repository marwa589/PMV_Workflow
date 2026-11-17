import { DocumentStatus, UserRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import DocumentStatusFilter from "@/components/document-status-filter";
import PageSummaryCards from "@/components/page-summary-cards";
import { getPoStatus, parseDocumentStatusFilter, parseMrTypeFilter, parsePoStatusFilter } from "@/lib/document-status";
import { getPurchaseOrderStatuses } from "@/lib/document-queries";
import { requireAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { getDocumentTracking } from "@/lib/download-tracking";
import { canViewKsaProject, getKsaProjectByKey, ksaProjectDirectorEmail } from "@/lib/ksa-projects";

export const dynamic = "force-dynamic";
const PENDING_STATUSES: DocumentStatus[] = [
  DocumentStatus.PENDING_APPROVER_1,
  DocumentStatus.PENDING_APPROVER_2,
  DocumentStatus.PENDING_APPROVER_3,
];

/** MRs of one KSA project (WP03, Tachalih KSA); same page as "MRs - Ready Mix Khobar". */
export default async function KsaProjectMrsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ status?: string; mrType?: string; poStatus?: string }>;
}) {
  const session = await requireAuth();
  const { project: projectKey } = await params;
  const project = getKsaProjectByKey(projectKey);
  if (!project) notFound();
  if (project.pagePath !== `/ksa-project-mrs/${project.key}`) redirect(project.pagePath);
  if (!canViewKsaProject(session, project)) redirect("/unauthorized");

  const filters = await searchParams;
  const statusFilter = parseDocumentStatusFilter(filters.status);
  const mrTypeFilter = parseMrTypeFilter(filters.mrType);
  const poStatusFilter = parsePoStatusFilter(filters.poStatus);
  const hasDirectorStage = Boolean(ksaProjectDirectorEmail(project, "MATERIAL_REQUISITION"));

  const records = await prisma.document.findMany({
    where: {
      projectName: project.name,
      documentType: "MATERIAL_REQUISITION",
    },
    include: {
      currentApprover: { select: { name: true } },
      relatedComparison: { select: { id: true, documentNumber: true } },
      approvals: {
        orderBy: { performedAt: "desc" },
        take: 1,
        select: { comments: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const poStatuses = await getPurchaseOrderStatuses(records.map((record) => record.id));
  const tracking = await getDocumentTracking(session.userId, records.map((record) => record.id));

  const documents = records
    .filter((record) => !statusFilter || record.status === statusFilter)
    .filter((record) => !mrTypeFilter || record.mrType === mrTypeFilter)
    .filter((record) => !poStatusFilter || getPoStatus(record.documentType, record.mrType, poStatuses.has(record.id), record.status) === poStatusFilter)
    .map((record) => ({
      id: record.id,
      documentNumber: record.documentNumber,
      title: record.title,
      status: record.status,
      statusLabel: hasDirectorStage && record.status === DocumentStatus.PENDING_APPROVER_1 && !record.redirectedById
        ? "Pending Project Director"
        : undefined,
      documentType: record.documentType,
      mrType: record.mrType,
      poStatus: getPoStatus(record.documentType, record.mrType, poStatuses.has(record.id), record.status),
      currentVersion: record.currentVersion,
      currentApproverName: record.currentApprover?.name ?? null,
      canReview: record.currentApproverId === session.userId
        && record.status !== DocumentStatus.APPROVED
        && record.status !== DocumentStatus.REJECTED,
      rejectionComments: record.approvals[0]?.comments ?? null,
      relatedComparisonId: record.relatedComparison?.id ?? null,
      relatedComparisonDocumentNumber: record.relatedComparison?.documentNumber ?? null,
      downloadedAt: tracking.get(record.id).downloadedAt,
      approvalDate: tracking.get(record.id).approvalDate,
      dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(record.updatedAt),
      lastUpdatedAt: record.updatedAt,
      isRedirected: Boolean(record.redirectedById),
    }));

  const summaryCards = [
    { label: `${project.name} MRs`, value: String(documents.length), tone: "bg-slate-900 text-white" },
    { label: "Pending", value: String(documents.filter((document) => PENDING_STATUSES.includes(document.status)).length), tone: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200" },
    { label: "Approved", value: String(documents.filter((document) => document.status === DocumentStatus.APPROVED).length), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
    { label: "Rejected", value: String(documents.filter((document) => document.status === DocumentStatus.REJECTED).length), tone: "bg-rose-50 text-rose-900 ring-1 ring-rose-200" },
  ];

  return (
    <DashboardShell role={session.role} userName={session.name} userEmail={session.email} title={project.navLabel} subtitle={`${project.name} material requisitions`}>
      <PageSummaryCards cards={summaryCards} />
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{project.name} MRs</h2>
        </div>
        <div className="border-b border-slate-200 px-5 py-4">
          <DocumentStatusFilter
            value={statusFilter}
            documentType="MATERIAL_REQUISITION"
            mrType={mrTypeFilter}
            poStatus={poStatusFilter}
            showMrTypeFilter
            showPoStatusFilter
          />
        </div>
        <DocumentListTable
          documents={documents}
          emptyMessage={`No ${project.name} MRs found.`}
          showBulkActions
          allowBulkDelete={session.role !== UserRole.ADMIN}
          allowAdminDelete={session.role === UserRole.ADMIN}
          allowReview
        />
      </section>
    </DashboardShell>
  );
}
