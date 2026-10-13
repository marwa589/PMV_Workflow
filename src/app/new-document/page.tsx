// src/app/new-document/page.tsx
import { ProcessStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import NewDocumentForm, { type UploadDocumentType, type UploadProcessContext } from "@/components/new-document-form";
import { requireAuth } from "@/lib/auth/guards";
import { buildProcessVisibilityWhere } from "@/lib/auth/access";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { optionValues } from "@/lib/document-fields";
import { prisma } from "@/lib/prisma";
import { canUserUploadAnything } from "@/lib/workflow/eligibility";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAuth();

  // Anyone a flow's uploader step names may open this; the exact type / project is checked when they submit.
  if (!(await canUserUploadAnything(prisma, { id: session.userId, userType: session.userType }))) {
    redirect("/unauthorized");
  }

  const params = (await searchParams) ?? {};
  const processInstanceId = typeof params.processInstanceId === "string" ? params.processInstanceId : "";

  const [types, projects] = await Promise.all([
    prisma.documentType.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        supportsLineItems: true,
        subtypes: { where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } },
        fieldDefinitions: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
          select: { id: true, fieldGroup: true, fieldKey: true, label: true, dataType: true, isRequired: true, options: true, documentSubtypeId: true },
        },
      },
    }),
    prisma.project.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const documentTypes: UploadDocumentType[] = types.map((type) => ({
    id: type.id,
    code: type.code,
    name: type.name,
    supportsLineItems: type.supportsLineItems,
    subtypes: type.subtypes,
    fields: type.fieldDefinitions.map((field) => ({ ...field, options: optionValues(field.options) })),
  }));

  // Opened from a process run: the current step decides the document type (and sub type), and the run's project.
  let process: UploadProcessContext | null = null;
  if (processInstanceId) {
    const visibility = await buildProcessVisibilityWhere(session);
    const run = await prisma.processInstance.findFirst({
      where: { AND: [{ id: processInstanceId, status: ProcessStatus.IN_PROGRESS }, visibility] },
      select: {
        id: true,
        reference: true,
        projectId: true,
        currentStepNumber: true,
        processDefinition: { select: { name: true, steps: { select: { stepNumber: true, name: true, documentTypeId: true, documentSubtypeId: true } } } },
      },
    });
    const step = run?.processDefinition.steps.find((candidate) => candidate.stepNumber === run.currentStepNumber);
    if (run && step) {
      process = {
        instanceId: run.id,
        label: `${run.processDefinition.name}${run.reference ? ` - ${run.reference}` : ""}`,
        stepName: step.name,
        documentTypeId: step.documentTypeId,
        documentSubtypeId: step.documentSubtypeId,
        projectId: run.projectId,
      };
    }
  }

  return (
    <DashboardShell role={session.userType} userName={session.name} title="New Document" subtitle="Upload and submit a document to start workflow">
      <NewDocumentForm documentTypes={documentTypes} projects={projects} defaultRedirectPath={getDefaultRouteForRole(session.userType)} process={process} />
    </DashboardShell>
  );
}
