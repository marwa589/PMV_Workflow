// src/app/new-document/page.tsx
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import AwaitingUploadsPanel from "@/components/awaiting-uploads-panel";
import NewDocumentForm, { type UploadBulkContext, type UploadDocumentType, type UploadProcessContext, type UploadStartProcess } from "@/components/new-document-form";
import { requireAuth } from "@/lib/auth/guards";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { optionValues } from "@/lib/document-fields";
import { prisma } from "@/lib/prisma";
import { canUserUpload, canUserUploadAnything, getUploadableScopeKeys } from "@/lib/workflow/eligibility";
import { USER_TYPE } from "@/lib/auth/roles";
import { appConfig } from "@/lib/env";
import { getAwaitingUploads, getRootReferenceConfigs, getStartableProcesses, getTaskOnlyChecker, getUploadTasks, type AwaitingUpload } from "@/lib/workflow/processes";
import { resolveFlow } from "@/lib/workflow/resolve-flow";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAuth();

  // Anyone a flow's uploader step names may open this; the exact type / project is checked when they submit.
  if (!(await canUserUploadAnything(prisma, { id: session.userId, userType: session.userType }))) {
    redirect("/unauthorized");
  }

  const params = (await searchParams) ?? {};
  const processInstanceId = typeof params.processInstanceId === "string" ? params.processInstanceId : "";
  const initialStepId = typeof params.processStepId === "string" ? params.processStepId : "";
  const startProcessId = typeof params.startProcessId === "string" ? params.startProcessId : "";
  const isAdmin = session.userType === USER_TYPE.ADMIN;
  // My Tasks "Upload several": several files of ONE sub type at once, each linked to the awaiting task it belongs to.
  const bulkTypeId = typeof params.bulkTypeId === "string" ? params.bulkTypeId : "";
  const bulkSubtypeId = typeof params.bulkSubtypeId === "string" ? params.bulkSubtypeId : "";
  if (bulkTypeId && (processInstanceId || startProcessId)) redirect("/tasks?tab=upload");

  // An Admin user starting a process on purpose: the first document of that process is uploaded here.
  let startProcess: UploadStartProcess | null = null;
  if (startProcessId) {
    if (!isAdmin || processInstanceId) redirect("/unauthorized");
    const found = (await getStartableProcesses(prisma)).find((candidate) => candidate.id === startProcessId);
    if (!found) redirect("/processes");
    startProcess = {
      definitionId: found.id,
      name: found.name,
      rootName: found.rootName,
      documentTypeId: found.documentTypeId,
      documentSubtypeId: found.documentSubtypeId,
      typeName: found.typeName,
      subtypeName: found.subtypeName,
    };
  }

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

  // The documents a later document of a process can follow: runs that wait for their next document, and completed runs
  // (the new document is added to the same group). Only runs the person may upload for are offered (the same rule as
  // My Tasks); Admin users see all of them.
  const linkedEntries: AwaitingUpload[] = [];
  let bulk: UploadBulkContext | null = null;
  if (bulkTypeId) {
    // Only the person's own upload tasks of this sub type (the same list as My Tasks), and only runs still waiting.
    const tasks = await getUploadTasks(prisma, { userId: session.userId, userType: session.userType }, { since: appConfig.emailPendingSince() });
    const matchesBulk = (option: { documentTypeId: string; documentSubtypeId: string | null }) =>
      option.documentTypeId === bulkTypeId && (option.documentSubtypeId ?? "") === bulkSubtypeId;
    const siblings: Record<string, string[]> = {};
    for (const task of tasks) {
      for (const option of task.options) {
        if (!matchesBulk(option)) continue;
        siblings[`${task.runId}|${option.stepId}`] = task.options.filter((other) => other.stepId !== option.stepId).map((other) => other.name);
      }
    }
    const awaiting = await getAwaitingUploads(prisma, { isAdmin });
    for (const entry of awaiting) {
      if (entry.mode === "continue" && entry.key in siblings) linkedEntries.push(entry);
    }
    if (linkedEntries.length === 0) redirect("/tasks?tab=upload");
    const first = linkedEntries[0].option;
    bulk = {
      documentTypeId: bulkTypeId,
      documentSubtypeId: bulkSubtypeId || null,
      label: `${first.typeName}${first.subtypeName ? ` - ${first.subtypeName}` : ""}`,
      siblings,
    };
  } else if (!process && !startProcess) {
    const awaiting = await getAwaitingUploads(prisma, { isAdmin });
    const actor = { id: session.userId, userType: session.userType };
    const allowedCache = new Map<string, boolean>();
    for (const entry of awaiting) {
      if (!isAdmin) {
        const key = `${entry.option.documentTypeId}|${entry.option.documentSubtypeId ?? ""}|${entry.projectId ?? ""}`;
        let allowed = allowedCache.get(key);
        if (allowed === undefined) {
          allowed = await canUserUpload(prisma, actor, { documentTypeId: entry.option.documentTypeId, documentSubtypeId: entry.option.documentSubtypeId, projectId: entry.projectId });
          allowedCache.set(key, allowed);
        }
        if (!allowed) continue;
      }
      linkedEntries.push(entry);
    }
  }

  // Reference documents: the types a step may ask for, and whether a NEW file of that type would need approval
  // (it cannot be uploaded as a reference then; an approved document must be picked instead).
  const rootReferences = process ? [] : await getRootReferenceConfigs(prisma);
  const referenceScopes = [
    ...rootReferences.map((config) => ({ typeId: config.referenceDocumentTypeId, subtypeId: config.referenceDocumentSubtypeId })),
    ...(process ? process.options.flatMap((option) => (option.referenceDocumentTypeId ? [{ typeId: option.referenceDocumentTypeId, subtypeId: option.referenceDocumentSubtypeId }] : [])) : []),
    ...linkedEntries.flatMap((entry) => (entry.option.referenceDocumentTypeId ? [{ typeId: entry.option.referenceDocumentTypeId, subtypeId: entry.option.referenceDocumentSubtypeId }] : [])),
  ];
  const referenceTypeRows = referenceScopes.length > 0
    ? await prisma.documentType.findMany({
        where: { id: { in: [...new Set(referenceScopes.map((scope) => scope.typeId))] } },
        select: { id: true, name: true, subtypes: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
      })
    : [];
  const referenceTypes = await Promise.all(
    referenceTypeRows.map(async (type) => {
      const probes = [null, ...type.subtypes.map((subtype) => subtype.id)];
      let requiresApproval = false;
      for (const subtypeId of probes) {
        const flow = await resolveFlow(prisma, { documentTypeId: type.id, documentSubtypeId: subtypeId, projectId: process?.projectId ?? null });
        if (flow.kind === "flow" && flow.template.steps.some((step) => step.stepNumber > 0)) requiresApproval = true;
      }
      return { id: type.id, name: type.name, subtypes: type.subtypes, requiresApproval };
    }),
  );

  const optionTypeIds = process ? process.options.map((option) => option.documentTypeId) : [];
  const [types, projects, isTaskOnly] = await Promise.all([
    prisma.documentType.findMany({
      // A running process keeps its configured documents even if their type or sub type is later deactivated.
      where: process ? { id: { in: optionTypeIds } } : bulk ? { id: bulk.documentTypeId } : { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        supportsLineItems: true,
        subtypes: {
          where: process || bulk ? {} : { isActive: true },
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
      // The director and manager are shown next to the project, so uploaders can check the document goes the right way.
      select: {
        id: true,
        code: true,
        name: true,
        director: { select: { name: true, isActive: true } },
        manager: { select: { name: true, isActive: true } },
      },
    }),
    getTaskOnlyChecker(prisma),
  ]);

  // Only what this person may upload is offered: a project, type or sub type they cannot upload is not shown, and the
  // combinations (type in project) are checked together by the form. Admin users and running processes are not limited
  // here (a run offers only its own configured choices, already limited to what the person may upload).
  const uploadScopeKeys = process || startProcess || bulk
    ? null
    : await getUploadableScopeKeys(prisma, { id: session.userId, userType: session.userType }, { projects, types });
  const allowedKeySet = uploadScopeKeys ? new Set(uploadScopeKeys) : null;
  const allowedTypeSubtype = new Set((uploadScopeKeys ?? []).map((key) => key.split("|").slice(1).join("|")));
  const allowedProjectIds = new Set((uploadScopeKeys ?? []).map((key) => key.split("|")[0]));
  const offeredTypes = bulk
    ? types.map((type) => ({ ...type, subtypes: type.subtypes.filter((subtype) => subtype.id === bulk?.documentSubtypeId) }))
    : allowedKeySet
    ? types
        .map((type) => ({ ...type, subtypes: type.subtypes.filter((subtype) => allowedTypeSubtype.has(`${type.id}|${subtype.id}`)) }))
        .filter((type) => (type.subtypes.length > 0 ? true : allowedTypeSubtype.has(`${type.id}|`)))
    : types;
  const offeredProjects = allowedKeySet ? projects.filter((project) => allowedProjectIds.has(project.id)) : projects;

  // Every active type / sub type can be picked here. A type that only exists as a LATER document of a process tree
  // (not a start document) must name the document it follows: the form asks for it and the server checks it.
  const documentTypes: UploadDocumentType[] = offeredTypes.map((type) => ({
    id: type.id,
    code: type.code,
    name: type.name,
    supportsLineItems: type.supportsLineItems,
    subtypes: type.subtypes,
    fields: type.fieldDefinitions.map((field) => ({ ...field, options: optionValues(field.options) })),
  }));
  const linkedTypeScopes: Array<{ documentTypeId: string; documentSubtypeId: string | null }> = process || bulk
    ? []
    : offeredTypes.flatMap((type) =>
        type.subtypes.length > 0
          ? type.subtypes.filter((subtype) => isTaskOnly({ documentTypeId: type.id, documentSubtypeId: subtype.id })).map((subtype) => ({ documentTypeId: type.id, documentSubtypeId: subtype.id as string | null }))
          : isTaskOnly({ documentTypeId: type.id, documentSubtypeId: null })
            ? [{ documentTypeId: type.id, documentSubtypeId: null as string | null }]
            : [],
      );

  // The documents waiting for this person to upload (shown at the top, the same list as My Tasks).
  const waitingUploads = process || startProcess || bulk ? [] : await getUploadTasks(prisma, { userId: session.userId, userType: session.userType });

  return (
    <DashboardShell
      role={session.userType}
      userName={session.name}
      title={startProcess ? "Start Process" : bulk ? "Upload Several Documents" : "New Document"}
      subtitle={startProcess ? "Upload the first document to start this process" : bulk ? `${bulk.label}: each file is linked to the task it belongs to` : "Upload and submit a document to start workflow"}
    >
      <AwaitingUploadsPanel
        items={waitingUploads.flatMap((task) =>
          task.options.map((option) => ({
            key: `${task.runId}|${option.stepId}`,
            name: option.name,
            typeLabel: option.typeName,
            linkedLabel: task.lastDocument ? `${task.lastDocument.documentNumber} · ${task.lastDocument.title}` : null,
            projectLabel: task.project ? `${task.project.code} - ${task.project.name}` : null,
            href: `/new-document?processInstanceId=${task.runId}&processStepId=${option.stepId}`,
          })),
        )}
      />
      <NewDocumentForm
        documentTypes={documentTypes}
        projects={offeredProjects}
        uploadScopeKeys={uploadScopeKeys}
        defaultRedirectPath={getDefaultRouteForRole(session.userType)}
        process={process}
        initialStepId={initialStepId}
        startProcess={startProcess}
        isAdmin={isAdmin}
        rootReferences={rootReferences}
        referenceTypes={referenceTypes}
        linkedTypeScopes={linkedTypeScopes}
        linkedEntries={linkedEntries}
        bulk={bulk}
      />
    </DashboardShell>
  );
}
