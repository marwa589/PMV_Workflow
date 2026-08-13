import { DocumentStatus, UserRole } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, FileText, History, UserCircle2 } from "lucide-react";
import DashboardShell from "@/components/dashboard-shell";
import StatusBadge from "@/components/status-badge";
import WorkflowJourneyChart from "@/components/workflow-journey-chart";
import { requireAuth } from "@/lib/auth/guards";
import { canAccessDocument } from "@/lib/auth/resource-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function getDocumentTypeLabel(documentType: "COMPARISON" | "MATERIAL_REQUISITION", mrType?: "CASH" | "CREDIT" | null) {
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
      createdBy: { select: { name: true, email: true } },
      currentApprover: { select: { name: true, email: true } },
      relatedComparison: { select: { id: true, documentNumber: true, title: true } },
      linkedMRs: { select: { id: true, documentNumber: true, title: true }, orderBy: { createdAt: "asc" } },
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
    },
  });

  if (!document) {
    notFound();
  }

  const latestComment = document.approvals.find((item) => item.comments)?.comments || null;
  const currentVersion = document.versions.find((version) => version.versionNumber === document.currentVersion);

  return (
    <DashboardShell
      role={session.role}
      userName={session.name}
      title="Document Details"
      subtitle="Review workflow history, status, and uploaded versions"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={session.role === UserRole.ADMIN ? "/admin" : session.role === UserRole.CLERK ? "/clerk" : "/approver"}
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
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Document overview</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{document.documentNumber}</h2>
            <p className="mt-2 text-sm text-slate-600">{document.title}</p>
          </div>
          <StatusBadge status={document.status} />
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
                    <span className="font-semibold text-slate-900">{document.relatedComparison ? document.relatedComparison.documentNumber : "None"}</span>
                  </div>
                </>
              ) : null}
              {document.documentType === "COMPARISON" ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-500">Linked MR</span>
                  <span className="font-semibold text-slate-900">{document.linkedMRs[0]?.documentNumber || "None"}</span>
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
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-500">Latest comment</span>
                <span className="font-semibold text-slate-900">{latestComment || "No comments yet"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <WorkflowJourneyChart status={document.status} lastActiveStage={document.lastActiveStage} />
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
                      <p className="text-sm font-semibold text-slate-900">Version {version.versionNumber}</p>
                      <p className="mt-1 text-sm text-slate-600">{version.originalName}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${version.versionNumber === document.currentVersion ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                      {version.versionNumber === document.currentVersion ? "Current" : "Archived"}
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

      {document.documentType === "MATERIAL_REQUISITION" && document.relatedComparison ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Related comparison</p>
              <p className="mt-1 text-sm text-slate-600">{document.relatedComparison.title}</p>
            </div>
            <Link href={`/documents/${document.relatedComparison.id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open comparison
            </Link>
          </div>
        </div>
      ) : null}

      {document.documentType === "COMPARISON" && document.linkedMRs[0] ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Linked MR</p>
              <p className="mt-1 text-sm text-slate-600">{document.linkedMRs[0].title}</p>
            </div>
            <Link href={`/documents/${document.linkedMRs[0].id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Open MR
            </Link>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <UserCircle2 className="h-4 w-4 text-slate-500" />
          <p className="text-sm font-semibold text-slate-900">Current file</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{currentVersion?.originalName || "No current file"}</p>
            <p className="mt-1 text-sm text-slate-600">Version {document.currentVersion}</p>
          </div>
          <a
            href={`/api/documents/${document.id}/download`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
        </div>
      </div>
    </DashboardShell>
  );
}
