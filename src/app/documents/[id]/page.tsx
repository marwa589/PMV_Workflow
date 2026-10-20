import { DocumentStatus, UserRole } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, FileCheck, FileText, History } from "lucide-react";
import DashboardShell from "@/components/dashboard-shell";
import StatusBadge from "@/components/status-badge";
import WorkflowJourneyChart from "@/components/workflow-journey-chart";
import PurchaseOrderUpload from "@/components/purchase-order-upload";
import { requireAuth } from "@/lib/auth/guards";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { canAccessDocument } from "@/lib/auth/resource-access";
import { isOmar } from "@/lib/po-access";
import { isKsaViewer, KSA_USER_LOCATIONS } from "@/lib/ksa-viewer";
import { canViewInvoicesForMr } from "@/lib/invoice-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function getDocumentTypeLabel(documentType: "COMPARISON" | "MATERIAL_REQUISITION" | "CUSTODY", mrType?: "CASH" | "CREDIT" | null) {
  if (documentType === "CUSTODY") return "Custody File";
  if (documentType === "MATERIAL_REQUISITION") {
    if (mrType === "CASH") return "MR - Cash";
    if (mrType === "CREDIT") return "MR - Credit";
    return "Material Requisition";
  }

  return "Comparison Sheet";
}

function formatDate(date: Date | null) {
  if (!date) return "Not assigned yet";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function DocumentDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;

  const allowed = await canAccessDocument(session, id);
  if (!allowed) {
    redirect("/unauthorized");
  }

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true, email: true, location: true } },
      currentApprover: { select: { name: true, email: true } },
      relatedComparison: { select: { id: true, documentNumber: true, title: true, createdBy: { select: { location: true } } } },
      downloadRecords: { where: { userId: session.userId }, select: { downloadedAt: true }, take: 1 },
      linkedMRs: { select: { id: true, documentNumber: true, title: true, createdBy: { select: { location: true } } }, orderBy: { createdAt: "asc" } },
      versions: {
        orderBy: { versionNumber: "asc" },
        select: {
          id: true,
          versionNumber: true,
          originalName: true,
          uploadedAt: true,
          uploadedBy: { select: { name: true } },
          mimeType: true,
        },
      },
      approvals: {
        orderBy: { performedAt: "desc" },
        include: {
          performedBy: { select: { name: true, email: true } },
        },
      },
      purchaseOrderLinks: {
        orderBy: { createdAt: "asc" },
        include: {
          purchaseOrder: {
            include: { uploadedBy: { select: { name: true } } },
          },
        },
      },
      invoices: {
        orderBy: { uploadedAt: "desc" },
        include: { uploadedBy: { select: { name: true } } },
      },
    },
  });

  if (!document) {
    notFound();
  }

  const hasPurchaseOrder = document.purchaseOrderLinks.length > 0;
  const visibleLinkedMrs = isKsaViewer(session)
    ? document.linkedMRs.filter((mr) => KSA_USER_LOCATIONS.includes(mr.createdBy.location as typeof KSA_USER_LOCATIONS[number]))
    : document.linkedMRs;
  const visibleRelatedComparison = document.relatedComparison && (!isKsaViewer(session)
    || KSA_USER_LOCATIONS.includes(document.relatedComparison.createdBy.location as typeof KSA_USER_LOCATIONS[number]))
    ? document.relatedComparison
    : null;
  const canReview =
    !isKsaViewer(session) &&
    document.currentApproverId === session.userId &&
    document.status !== DocumentStatus.APPROVED &&
    document.status !== DocumentStatus.REJECTED;
  const canViewDirectMrInvoices = document.documentType === "MATERIAL_REQUISITION"
    && await canViewInvoicesForMr(session, document.id);
  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="Document Details"
      subtitle="Review workflow history, status, and uploaded versions"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={getDefaultRouteForRole(session.role)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
        <a
          href={`/api/documents/${document.id}/download`}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Download className="h-4 w-4" />
          Download current file
        </a>
        <a
          href={`/api/documents/${document.id}/download?inline=1`}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100"
        >
          <FileText className="h-4 w-4" />
          Open File
        </a>
        {canReview ? (
          <Link
            href={`/approver/review/${document.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileCheck className="h-4 w-4" />
            Review
          </Link>
        ) : null}
        {session.role !== UserRole.KSA_VIEWER && document.documentType === "MATERIAL_REQUISITION" && document.status === DocumentStatus.APPROVED && isOmar(session) ? (
          <PurchaseOrderUpload
            approvedMrs={[{ id: document.id, documentNumber: document.documentNumber, title: document.title, mrNumber: document.mrNumber, fileName: document.versions[0]?.originalName }]}
            initialMrId={document.id}
            showMrSelection={false}
          />
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Document overview</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{document.documentNumber}</h2>
            <p className="mt-2 text-sm text-slate-600">{document.title}</p>
          </div>
          <StatusBadge
            status={document.status}
            label={(document.documentType === "MATERIAL_REQUISITION" || document.documentType === "COMPARISON") && document.projectName === "Ready Mix Khobar" && document.status === DocumentStatus.PENDING_APPROVER_1 ? "Pending Project Director" : undefined}
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Document type</span>
                <span className="font-semibold text-slate-900">{getDocumentTypeLabel(document.documentType, document.mrType)}</span>
              </div>
              {document.documentType === "MATERIAL_REQUISITION" ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-500">MR number</span>
                    <span className="font-semibold text-slate-900">{document.mrNumber || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-500">Related comparison</span>
                    {visibleRelatedComparison ? (
                      <Link
                        href={`/documents/${visibleRelatedComparison.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-cyan-700 hover:text-cyan-900 hover:underline"
                      >
                        {visibleRelatedComparison.documentNumber}
                      </Link>
                    ) : (
                      <span className="font-semibold text-slate-900">None</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-500">PO status</span>
                    <span className={`font-semibold ${document.status === "REJECTED" ? "text-rose-700" : document.mrType === "CREDIT" ? hasPurchaseOrder ? "text-emerald-700" : "text-amber-700" : "text-slate-600"}`}>
                      {document.status === "REJECTED" ? "Document Rejected" : document.mrType === "CREDIT" ? hasPurchaseOrder ? "PO Uploaded" : "PO Pending" : "Not Applicable"}
                    </span>
                  </div>
                </>
              ) : null}
              {document.documentType === "COMPARISON" ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-500">Linked MR</span>
                  <span className="font-semibold text-slate-900">{visibleLinkedMrs[0]?.documentNumber || "None"}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Current version</span>
                <span className="font-semibold text-slate-900">V{document.currentVersion}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Submitted by</span>
                <span className="font-semibold text-slate-900">{document.createdBy.name}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Current approver</span>
                <span className="font-semibold text-slate-900">{document.currentApprover?.name || "Unassigned"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Assigned at</span>
                <span className="font-semibold text-slate-900">{formatDate(document.currentApproverAssignedAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Created</span>
                <span className="font-semibold text-slate-900">{formatDate(document.createdAt)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <WorkflowJourneyChart status={document.status} lastActiveStage={document.lastActiveStage} downloadedAt={document.downloadRecords[0]?.downloadedAt ?? null} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
            <History className="h-4 w-4 text-slate-500" />
            <h3 className="text-base font-semibold text-slate-900">Workflow history</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {document.approvals.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">No workflow activity recorded yet.</div>
            ) : (
              document.approvals.map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{item.action.replaceAll("_", " ")}</p>
                    <p className="text-xs text-slate-500">{formatDate(item.performedAt)}</p>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">By {item.performedBy.name} ({item.performedBy.email})</p>
                  {item.comments ? <p className="mt-2 text-sm text-slate-600">{item.comments}</p> : null}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
            <FileText className="h-4 w-4 text-slate-500" />
            <h3 className="text-base font-semibold text-slate-900">Document versions</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {document.versions.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">No versions uploaded yet.</div>
            ) : (
              document.versions.map((version) => (
                <div key={version.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Current File</p>
                      <p className="mt-1 text-sm text-slate-600">{version.originalName}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      Current
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>Uploaded by {version.uploadedBy.name}</span>
                    <span>{formatDate(version.uploadedAt)}</span>
                    <span>{version.mimeType}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {document.documentType === "MATERIAL_REQUISITION" && visibleRelatedComparison ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Related comparison</p>
              <p className="mt-1 text-sm text-slate-600">{visibleRelatedComparison.title}</p>
            </div>
            <Link href={`/documents/${visibleRelatedComparison.id}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open comparison
            </Link>
          </div>
        </div>
      ) : null}

      {document.documentType === "COMPARISON" && visibleLinkedMrs.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Linked MRs</p>
              <div className="mt-1 space-y-1 text-sm text-slate-600">
                {visibleLinkedMrs.map((linkedMr) => (
                  <p key={linkedMr.id}>{linkedMr.documentNumber}: {linkedMr.title}</p>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleLinkedMrs.map((linkedMr) => (
                <Link key={linkedMr.id} href={`/documents/${linkedMr.id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Open {linkedMr.documentNumber}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {document.documentType === "MATERIAL_REQUISITION" ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Linked POs</h3>
          </div>
          {document.purchaseOrderLinks.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No purchase orders linked.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-5 py-3 font-semibold">PO Number / Filename</th><th className="px-5 py-3 font-semibold">Upload Date</th><th className="px-5 py-3 font-semibold">Uploaded By</th><th className="px-5 py-3 font-semibold">Open File</th></tr>
                </thead>
                <tbody>
                  {document.purchaseOrderLinks.map(({ purchaseOrder }) => (
                    <tr key={purchaseOrder.id} className="border-t border-slate-100">
                      <td className="px-5 py-4"><Link href={`/purchase-orders/${purchaseOrder.id}`} className="font-medium text-cyan-700 hover:underline">{purchaseOrder.poNumber}</Link><span className="ml-2 text-slate-500">{purchaseOrder.originalName}</span></td>
                      <td className="px-5 py-4 text-slate-600">{formatDate(purchaseOrder.uploadedAt)}</td>
                      <td className="px-5 py-4 text-slate-600">{purchaseOrder.uploadedBy.name}</td>
                      <td className="px-5 py-4"><a href={`/api/purchase-orders/${purchaseOrder.id}/download?inline=1`} target="_blank" rel="noopener noreferrer" className="font-medium text-cyan-700 hover:underline">Open File</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {canViewDirectMrInvoices && document.mrType === "CASH" ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4"><h3 className="text-base font-semibold text-slate-900">Cash MR Invoices</h3></div>
          {document.invoices.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">No invoices uploaded for this Cash MR.</p> : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Invoice</th><th className="px-5 py-3 font-semibold">Uploaded</th><th className="px-5 py-3 font-semibold">Uploaded By</th><th className="px-5 py-3 font-semibold">Action</th></tr></thead>
                <tbody>{document.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t border-slate-100">
                    <td className="px-5 py-4 font-medium text-slate-900">{invoice.originalName}</td>
                    <td className="px-5 py-4 text-slate-600">{formatDate(invoice.uploadedAt)}</td>
                    <td className="px-5 py-4 text-slate-600">{invoice.uploadedBy.name}</td>
                    <td className="px-5 py-4"><a href={`/api/invoices/${invoice.id}/download`} className="font-medium text-cyan-700 hover:underline">Download</a></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

    </DashboardShell>
  );
}
