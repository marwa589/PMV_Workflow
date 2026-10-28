// src/app/documents/[id]/page.tsx
import { DocumentStatus, FieldDataType } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, FileCheck, FileText, History, Network } from "lucide-react";
import DashboardShell from "@/components/dashboard-shell";
import DocumentDetailActions from "@/components/document-detail-actions";
import StatusBadge from "@/components/status-badge";
import WorkflowJourneyChart from "@/components/workflow-journey-chart";
import { requireAuth } from "@/lib/auth/guards";
import { buildDocumentVisibilityWhere, canAccessDocument, userHasPermissionForDocument } from "@/lib/auth/access";
import { USER_TYPE } from "@/lib/auth/roles";
import { getDocumentStatusDisplay } from "@/lib/document-status";
import { prisma } from "@/lib/prisma";
import { createEligibilityChecker } from "@/lib/workflow/eligibility";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

type FieldValueRow = {
  valueText: string | null;
  valueNumber: { toString(): string } | null;
  valueDate: Date | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
  fieldDefinition: { label: string; dataType: FieldDataType; sortOrder: number };
};

function displayFieldValue(value: FieldValueRow): string {
  switch (value.fieldDefinition.dataType) {
    case FieldDataType.NUMBER:
      return value.valueNumber?.toString() ?? "—";
    case FieldDataType.DATE:
      return value.valueDate ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(value.valueDate) : "—";
    case FieldDataType.BOOLEAN:
      return value.valueBoolean === null ? "—" : value.valueBoolean ? "Yes" : "No";
    case FieldDataType.MULTI_SELECT:
      return Array.isArray(value.valueJson) ? value.valueJson.join(", ") : "—";
    default:
      return value.valueText || "—";
  }
}

export default async function DocumentDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;

  if (!(await canAccessDocument(session, id))) {
    redirect("/unauthorized");
  }

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true, email: true } },
      receivedBy: { select: { name: true } },
      downloadRecords: { where: { userId: session.userId }, select: { downloadedAt: true }, take: 1 },
      documentType: { select: { code: true, name: true } },
      documentSubtype: { select: { code: true, name: true } },
      project: { select: { id: true, code: true, name: true, locationId: true, location: { select: { name: true } } } },
      approvals: {
        orderBy: { performedAt: "desc" },
        include: { performedBy: { select: { name: true, email: true } }, onBehalfOf: { select: { name: true } } },
      },
      approvalSteps: {
        orderBy: { levelNumber: "asc" },
        include: {
          approvers: { include: { user: { select: { name: true } }, userType: { select: { name: true } } } },
          actedBy: { select: { name: true } },
        },
      },
      fieldValues: {
        include: { fieldDefinition: { select: { label: true, dataType: true, sortOrder: true } }, lineItem: { select: { lineNo: true } } },
      },
      lineItems: { orderBy: { lineNo: "asc" }, select: { id: true, lineNo: true } },
      processLinks: {
        select: {
          processInstanceId: true,
          processInstance: {
            select: {
              id: true,
              stepDocuments: {
                where: { isCurrent: true },
                orderBy: { processStep: { stepNumber: "asc" } },
                select: { documentId: true, processStep: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!document) {
    notFound();
  }

  // Linked documents: the other documents of the same process run(s), limited to what this person may see.
  const linkedStepNames = new Map<string, string>();
  for (const link of document.processLinks) {
    for (const item of link.processInstance.stepDocuments) {
      if (item.documentId !== document.id && !linkedStepNames.has(item.documentId)) linkedStepNames.set(item.documentId, item.processStep.name);
    }
  }
  const linkedDocuments =
    linkedStepNames.size === 0
      ? []
      : await prisma.document.findMany({
          where: { AND: [{ id: { in: [...linkedStepNames.keys()] } }, await buildDocumentVisibilityWhere(session)] },
          select: { id: true, documentNumber: true, title: true, status: true, currentWorkflowStep: true, createdAt: true, documentType: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        });
  const isAdminUser = session.userType === USER_TYPE.ADMIN;

  // ---- What can this person do here? ----
  const currentStep = document.currentWorkflowStep === null ? null : document.approvalSteps.find((step) => step.levelNumber === document.currentWorkflowStep) ?? null;
  const actingLevel = document.status === DocumentStatus.REVISION_REQUIRED ? 0 : document.currentWorkflowStep;
  const actingStep = actingLevel === null ? null : document.approvalSteps.find((step) => step.levelNumber === actingLevel) ?? null;
  const isActionable = document.status === DocumentStatus.PENDING || document.status === DocumentStatus.ON_HOLD || document.status === DocumentStatus.REVISION_REQUIRED;

  let canReview = false;
  if (isActionable && actingStep) {
    const canAct = await createEligibilityChecker(prisma, session.userId);
    // Admin users may act on any level (the review page and the workflow engine allow it), so they always get the button.
    canReview =
      session.userType === USER_TYPE.ADMIN ||
      (document.status === DocumentStatus.REVISION_REQUIRED && document.createdById === session.userId) ||
      canAct(actingStep.approvers, {
        projectId: document.projectId,
        locationId: document.project?.locationId ?? null,
        documentTypeId: document.documentTypeId,
        documentSubtypeId: document.documentSubtypeId,
      });
  }

  const permissionScope = { projectId: document.projectId, documentTypeId: document.documentTypeId, documentSubtypeId: document.documentSubtypeId, project: document.project ? { locationId: document.project.locationId } : null };
  const canConfirmReceipt = document.status === DocumentStatus.APPROVED && !document.receivedAt && (await userHasPermissionForDocument(session, "documents.confirm_receipt", permissionScope));
  const canArchive = await userHasPermissionForDocument(session, "documents.archive", permissionScope);

  const waitingFor = currentStep
    ? currentStep.approvers.map((entry) => (entry.user?.name ?? entry.userType?.name ?? "")).filter(Boolean).join(", ")
    : "";
  const statusText = getDocumentStatusDisplay(document.status, { levelNumber: document.currentWorkflowStep, name: currentStep?.name });
  const showApprovalPath = session.userType === USER_TYPE.ADMIN || session.userType === USER_TYPE.MANAGER;
  const homeHref = session.userType === USER_TYPE.ADMIN ? "/admin" : session.userType === USER_TYPE.CLERK ? "/clerk" : "/approver";

  const headerFields = document.fieldValues
    .filter((value) => value.lineItem === null)
    .sort((a, b) => a.fieldDefinition.sortOrder - b.fieldDefinition.sortOrder);
  const lineColumns = [...new Map(document.fieldValues.filter((value) => value.lineItem).map((value) => [value.fieldDefinition.label, value.fieldDefinition.sortOrder])).entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([label]) => label);

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Document Details" subtitle="Review workflow history and status">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={homeHref} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
        <a href={`/api/documents/${document.id}/download`} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
          <Download className="h-4 w-4" />
          Download current file
        </a>
        <a href={`/api/documents/${document.id}/download?inline=1`} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100">
          <FileText className="h-4 w-4" />
          Open File
        </a>
        {canReview ? (
          <Link href={`/approver/review/${document.id}`} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <FileCheck className="h-4 w-4" />
            {document.status === DocumentStatus.REVISION_REQUIRED ? "Revise and resubmit" : "Review"}
          </Link>
        ) : null}
        <DocumentDetailActions
          documentId={document.id}
          canConfirmReceipt={canConfirmReceipt}
          canArchive={canArchive}
          isArchived={document.status === DocumentStatus.ARCHIVED}
          canBeArchived={document.status === DocumentStatus.APPROVED || document.status === DocumentStatus.CANCELLED}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Document overview</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{document.documentNumber}</h2>
            <p className="mt-2 text-sm text-slate-600">{document.title}</p>
          </div>
          <StatusBadge status={document.status} label={statusText} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="space-y-3 text-sm text-slate-700">
              <Row label="Project" value={document.project ? `${document.project.code} - ${document.project.name}` : "—"} />
              {document.project?.location ? <Row label="Location" value={document.project.location.name} /> : null}
              {headerFields.map((value, index) => (
                <Row key={`${value.fieldDefinition.label}-${index}`} label={value.fieldDefinition.label} value={displayFieldValue(value)} />
              ))}
              {isAdminUser ? <Row label="Current version" value={`V${document.currentVersion}`} /> : null}
              <Row label="Submitted by" value={document.createdBy.name} />
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <div className="space-y-3 text-sm text-slate-700">
              <Row label="Waiting for" value={waitingFor || (document.status === DocumentStatus.APPROVED ? "Approved" : "—")} />
              <Row label="Waiting since" value={formatDate(document.currentApproverAssignedAt)} />
              <Row label="Created" value={formatDate(document.createdAt)} />
              <Row label="Approved" value={formatDate(document.approvedAt)} />
              {document.receivedAt ? <Row label="Received" value={`${formatDate(document.receivedAt)}${document.receivedBy ? ` by ${document.receivedBy.name}` : ""}`} /> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <WorkflowJourneyChart
          status={document.status}
          currentWorkflowStep={document.currentWorkflowStep}
          steps={document.approvalSteps.map((step) => ({ levelNumber: step.levelNumber, name: step.name, status: step.status }))}
          downloadedAt={document.downloadRecords[0]?.downloadedAt ?? null}
        />
      </div>

      {/* The approval path (who approves at each level) is for managers and admins; clerks and engineers see the journey and history. */}
      {showApprovalPath && document.approvalSteps.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Approval path</h3>
            <p className="mt-1 text-sm text-slate-500">Any one person listed at a level can act on it.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {document.approvalSteps.map((step) => (
              <div key={step.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{step.levelNumber === 0 ? "Uploader" : step.name || `Level ${step.levelNumber}`}</p>
                  <p className="text-slate-600">
                    {step.approvers.map((entry) => (entry.user ? entry.user.name : `Any ${entry.userType?.name ?? "user"}`)).join(" or ") || "—"}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p className="font-medium text-slate-700">{step.status.replaceAll("_", " ")}</p>
                  {step.actedBy ? <p>{step.actedBy.name}, {formatDate(step.actedAt)}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {document.lineItems.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-900">Items</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">#</th>
                  {lineColumns.map((label) => (
                    <th key={label} className="px-5 py-3 font-semibold">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {document.lineItems.map((line) => (
                  <tr key={line.id} className="border-t border-slate-100">
                    <td className="px-5 py-3 text-slate-500">{line.lineNo}</td>
                    {lineColumns.map((label) => {
                      const cell = document.fieldValues.find((value) => value.lineItem?.lineNo === line.lineNo && value.fieldDefinition.label === label);
                      return <td key={label} className="px-5 py-3 text-slate-700">{cell ? displayFieldValue(cell) : "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6">
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
                  <p className="mt-1 text-sm text-slate-700">
                    By {item.performedBy.name} ({item.performedBy.email})
                    {item.onBehalfOf ? ` on behalf of ${item.onBehalfOf.name}` : ""}
                  </p>
                  {item.revisionTargetLevel !== null && item.revisionTargetLevel !== undefined ? (
                    <p className="mt-1 text-xs text-slate-500">Sent back to {item.revisionTargetLevel === 0 ? "the uploader" : `level ${item.revisionTargetLevel}`}</p>
                  ) : null}
                  {item.comments ? <p className="mt-2 text-sm text-slate-600">{item.comments}</p> : null}
                </div>
              ))
            )}
          </div>
        </section>

      </div>

      {/* Documents that share a process run with this one. */}
      {linkedDocuments.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-slate-500" />
              <h3 className="text-base font-semibold text-slate-900">Linked documents</h3>
            </div>
            {isAdminUser && document.processLinks[0] ? (
              <Link href={`/processes/${document.processLinks[0].processInstance.id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Open process run
              </Link>
            ) : null}
          </div>
          <div className="divide-y divide-slate-100">
            {linkedDocuments.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <Link href={`/documents/${item.id}`} className="font-medium text-cyan-700 hover:underline">{item.documentNumber}</Link>
                  <p className="text-xs text-slate-500">{item.documentType.name} · {item.title}</p>
                </div>
                <StatusBadge status={item.status} label={getDocumentStatusDisplay(item.status, { levelNumber: item.currentWorkflowStep })} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </DashboardShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-900">{value}</span>
    </div>
  );
}
