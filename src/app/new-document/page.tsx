// src/app/new-document/page.tsx
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import NewDocumentForm, { type UploadDocumentType, type UploadProcessContext } from "@/components/new-document-form";
import { requireAuth } from "@/lib/auth/guards";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { optionValues } from "@/lib/document-fields";
import { prisma } from "@/lib/prisma";
import { canUserUploadAnything } from "@/lib/workflow/eligibility";
import { getTaskOnlyChecker, getUploadTasks } from "@/lib/workflow/processes";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAuth();

  // Anyone a flow's uploader step names may open this; the exact type / project is checked when they submit.
  if (!(await canUserUploadAnything(prisma, { id: session.userId, userType: session.userType }))) {
    redirect("/unauthorized");
  }

  const params = (await searchParams) ?? {};
  const processInstanceId = typeof params.processInstanceId === "string" ? params.processInstanceId : "";

  // The next document of a running process: only the choices this person may upload are offered. They come from
  // the same list as My Tasks, so a run that is not waiting for an upload (or not for this person) shows nothing here.
  let process: UploadProcessContext | null = null;
  if (processInstanceId) {
    const tasks = await getUploadTasks(prisma, { userId: session.userId, userType: session.userType });
    const task = tasks.find((candidate) => candidate.runId === processInstanceId);
    if (!task) redirect("/tasks");
    const run = await prisma.processInstance.findUnique({ where: { id: processInstanceId }, select: { projectId: true } });
    process = {
      instanceId: task.runId,
      label: `${task.processName}${task.reference ? ` - ${task.reference}` : ""}`,
      projectId: run?.projectId ?? null,
      options: task.options,
    };
  }

  const optionTypeIds = process ? process.options.map((option) => option.documentTypeId) : [];
  const [types, projects, isTaskOnly] = await Promise.all([
    prisma.documentType.findMany({
      // A running process keeps its configured documents even if their type or sub type is later deactivated.
      where: process ? { id: { in: optionTypeIds } } : { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        supportsLineItems: true,
        subtypes: {
          where: process ? {} : { isActive: true },
          select: { id: true, code: true, name: true },
          orderBy: { name: "asc" },
        },
        fieldDefinitions: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
          select: { id: true, fieldGroup: true, fieldKey: true, label: true, dataType: true, isRequired: true, options: true, documentSubtypeId: true },
        },
      },
    }),
    prisma.project.findMany({
      where: process?.projectId ? { OR: [{ isActive: true }, { id: process.projectId }] } : { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    getTaskOnlyChecker(prisma),
  ]);

  // Outside a process, types / sub types that only exist as a LATER document of a process tree are not offered here:
  // they are uploaded from My Tasks. Roots (which start a process) and documents in no tree stay available.
  const documentTypes: UploadDocumentType[] = types.flatMap((type) => {
    const subtypes = process
      ? type.subtypes
      : type.subtypes.filter((subtype) => !isTaskOnly({ documentTypeId: type.id, documentSubtypeId: subtype.id }));
    const offered = process || (type.subtypes.length > 0 ? subtypes.length > 0 : !isTaskOnly({ documentTypeId: type.id, documentSubtypeId: null }));
    if (!offered) return [];
    return [
      {
        id: type.id,
        code: type.code,
        name: type.name,
        supportsLineItems: type.supportsLineItems,
        subtypes,
        fields: type.fieldDefinitions.map((field) => ({ ...field, options: optionValues(field.options) })),
      },
    ];
  });

  return (
    <DashboardShell role={session.userType} userName={session.name} title="New Document" subtitle="Upload and submit a document to start workflow">
      <NewDocumentForm documentTypes={documentTypes} projects={projects} defaultRedirectPath={getDefaultRouteForRole(session.userType)} process={process} />
    </DashboardShell>
  );
}
