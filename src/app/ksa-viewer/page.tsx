import { DocumentStatus, UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import DocumentListTable from "@/components/document-list-table";
import PageSummaryCards from "@/components/page-summary-cards";
import { requireAuth } from "@/lib/auth/guards";
import { getPoStatus } from "@/lib/document-status";
import { getPurchaseOrderStatuses } from "@/lib/document-queries";
import { prisma } from "@/lib/prisma";
import { KSA_USER_LOCATIONS } from "@/lib/ksa-viewer";

export const dynamic = "force-dynamic";

const READY_MIX_KHOBAR_PROJECT_NAME = "Ready Mix Khobar";

export default async function KsaViewerPage({ searchParams }: { searchParams: Promise<{ location?: string; documentType?: string; project?: string }> }) {
  const session = await requireAuth();
  if (session.role !== UserRole.KSA_VIEWER) redirect("/unauthorized");

  const params = await searchParams;
  const location = params.location === "AVR" || params.location === "AVK" ? params.location : "";
  const documentType = params.documentType === "MATERIAL_REQUISITION" || params.documentType === "COMPARISON"
    ? params.documentType
    : "";
  const showReadyMixMrs = params.project === "READY_MIX_KHOBAR" && documentType === "MATERIAL_REQUISITION";

  const records = await prisma.document.findMany({
    where: {
      documentType: documentType || { in: ["MATERIAL_REQUISITION", "COMPARISON"] },
      createdBy: { location: { in: [...KSA_USER_LOCATIONS] } },
      ...(location ? { createdBy: { location } } : {}),
      ...(showReadyMixMrs ? { projectName: READY_MIX_KHOBAR_PROJECT_NAME } : {}),
    },
    include: {
      currentApprover: { select: { name: true } },
      downloadRecords: { where: { userId: session.userId }, select: { downloadedAt: true }, take: 1 },
      relatedComparison: { select: { id: true, documentNumber: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const poStatuses = await getPurchaseOrderStatuses(records.map((record) => record.id));
  const documents = records.map((record) => ({
    id: record.id,
    documentNumber: record.documentNumber,
    title: record.title,
    status: record.status,
    documentType: record.documentType,
    mrType: record.mrType,
    poStatus: getPoStatus(record.documentType, record.mrType, poStatuses.has(record.id), record.status),
    currentVersion: record.currentVersion,
    currentApproverName: record.currentApprover?.name ?? null,
    relatedComparisonId: record.relatedComparison?.id ?? null,
    relatedComparisonDocumentNumber: record.relatedComparison?.documentNumber ?? null,
    downloadedAt: record.downloadRecords[0]?.downloadedAt ?? null,
    dateLabel: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(record.updatedAt),
  }));
  const materialRequisitions = documents.filter((document) => document.documentType === "MATERIAL_REQUISITION");
  const comparisons = documents.filter((document) => document.documentType === "COMPARISON");
  const pageTitle = showReadyMixMrs
    ? "MRs - Ready Mix Khobar"
    : documentType === "COMPARISON"
      ? "Comparison Sheets"
      : location
        ? `MRs - ${location}`
        : "KSA Viewer";

  return (
    <DashboardShell role={session.role} userName={session.name} title={pageTitle} subtitle="Read-only KSA document access">
      <PageSummaryCards cards={[
        { label: "AVR / AVK MRs", value: String(materialRequisitions.length), tone: "bg-slate-900 text-white" },
        { label: "Comparisons", value: String(comparisons.length), tone: "bg-sky-50 text-sky-900 ring-1 ring-sky-200" },
        { label: "Approved", value: String(documents.filter((document) => document.status === DocumentStatus.APPROVED).length), tone: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200" },
        { label: "Pending", value: String(documents.filter((document) => document.status === DocumentStatus.PENDING_APPROVER_1 || document.status === DocumentStatus.PENDING_APPROVER_2 || document.status === DocumentStatus.PENDING_APPROVER_3).length), tone: "bg-yellow-50 text-yellow-900 ring-1 ring-yellow-200" },
      ]} />
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{pageTitle === "KSA Viewer" ? "AVR / AVK MRs and Comparisons" : pageTitle}</h2>
        </div>
        <DocumentListTable documents={documents} emptyMessage={`No ${pageTitle === "KSA Viewer" ? "AVR or AVK MRs and comparisons" : pageTitle} found.`} showBulkActions showDownloadTracking />
      </section>
    </DashboardShell>
  );
}
