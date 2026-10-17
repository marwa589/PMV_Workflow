// src/app/api/admin/assignments/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { optionalId, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const assignmentSelect = {
  id: true,
  userId: true,
  roleId: true,
  companyId: true,
  projectId: true,
  locationId: true,
  documentTypeId: true,
  documentSubtypeId: true,
  processDefinitionId: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  role: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, name: true } },
  documentType: { select: { id: true, code: true, name: true } },
  documentSubtype: { select: { id: true, code: true, name: true, documentTypeId: true } },
  processDefinition: { select: { id: true, name: true } },
  projectScopes: { select: { project: { select: { id: true, code: true, name: true } } } },
  documentTypeScopes: {
    select: {
      documentType: { select: { id: true, code: true, name: true } },
      allSubtypes: true,
      subtypes: { select: { documentSubtype: { select: { id: true, code: true, name: true } } } },
    },
  },
  processScopes: { select: { processDefinition: { select: { id: true, name: true } } } },
} as const;

/**
 * One assignment can contain multiple values in each scope dimension. Empty scope lists mean no
 * restriction, while each selected document type independently has an all-subtypes or selected-subtypes scope.
 */
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const userId = new URL(request.url).searchParams.get("userId")?.trim();

  const [storedAssignments, users, roles, companies, projects, locations, documentTypes, processes] = await Promise.all([
    prisma.userAssignment.findMany({ where: userId ? { userId } : {}, select: assignmentSelect, orderBy: [{ user: { name: "asc" } }, { createdAt: "asc" }] }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, userType: { select: { code: true, name: true } } }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.documentType.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, subtypes: { where: { isActive: true }, select: { id: true, code: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.processDefinition.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const assignments = storedAssignments.map((assignment) => {
    const projectById = new Map<string, (typeof projects)[number]>();
    if (assignment.project) projectById.set(assignment.project.id, assignment.project);
    for (const scope of assignment.projectScopes) projectById.set(scope.project.id, scope.project);

    const typeScopes = new Map<string, {
      documentType: { id: string; code: string; name: string };
      allSubtypes: boolean;
      subtypes: Array<{ id: string; code: string; name: string }>;
    }>();
    for (const scope of assignment.documentTypeScopes) {
      typeScopes.set(scope.documentType.id, {
        documentType: scope.documentType,
        allSubtypes: scope.allSubtypes,
        subtypes: scope.subtypes.map((entry) => entry.documentSubtype),
      });
    }
    if (assignment.documentType && !typeScopes.has(assignment.documentType.id)) {
      typeScopes.set(assignment.documentType.id, {
        documentType: assignment.documentType,
        allSubtypes: !assignment.documentSubtype,
        subtypes: assignment.documentSubtype ? [assignment.documentSubtype] : [],
      });
    }

    const processById = new Map<string, { id: string; name: string }>();
    if (assignment.processDefinition) processById.set(assignment.processDefinition.id, assignment.processDefinition);
    for (const scope of assignment.processScopes) processById.set(scope.processDefinition.id, scope.processDefinition);

    return {
      id: assignment.id,
      user: assignment.user,
      role: assignment.role,
      company: assignment.company,
      location: assignment.location,
      projects: [...projectById.values()],
      documentTypeScopes: [...typeScopes.values()],
      processes: [...processById.values()],
    };
  });

  return NextResponse.json({ assignments, users, roles, companies, projects, locations, documentTypes, processes });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const userId = optionalId(body?.userId);
  const roleId = optionalId(body?.roleId);
  const projectIds = body && Array.isArray(body.projectIds)
    ? parseIds(body.projectIds)
    : parseIds([body?.projectId]);
  const processDefinitionIds = body && Array.isArray(body.processDefinitionIds)
    ? parseIds(body.processDefinitionIds)
    : parseIds([body?.processDefinitionId]);
  const documentTypeScopes = parseDocumentTypeScopes(body);
  const companyId = optionalId(body?.companyId);
  const locationId = optionalId(body?.locationId);

  if (!userId || !roleId) return NextResponse.json({ message: "User and role are required." }, { status: 400 });

  if (!documentTypeScopes) {
    return NextResponse.json({ message: "Each document type needs a valid subtype selection." }, { status: 400 });
  }

  const subtypeIds = documentTypeScopes.flatMap((scope) => scope.subtypeIds);
  const [validProjects, validProcesses, validTypes, validSubtypes] = await Promise.all([
    prisma.project.count({ where: { id: { in: projectIds }, isActive: true } }),
    prisma.processDefinition.count({ where: { id: { in: processDefinitionIds }, isActive: true } }),
    prisma.documentType.count({ where: { id: { in: documentTypeScopes.map((scope) => scope.documentTypeId) }, isActive: true } }),
    prisma.documentSubtype.findMany({
      where: { id: { in: subtypeIds }, isActive: true },
      select: { id: true, documentTypeId: true },
    }),
  ]);
  if (validProjects !== projectIds.length) return NextResponse.json({ message: "One or more selected projects are unavailable." }, { status: 400 });
  if (validProcesses !== processDefinitionIds.length) return NextResponse.json({ message: "One or more selected processes are unavailable." }, { status: 400 });
  if (validTypes !== documentTypeScopes.length) return NextResponse.json({ message: "One or more selected document types are unavailable." }, { status: 400 });
  if (validSubtypes.length !== subtypeIds.length) return NextResponse.json({ message: "One or more selected subtypes are unavailable." }, { status: 400 });

  const subtypeTypeById = new Map(validSubtypes.map((subtype) => [subtype.id, subtype.documentTypeId]));
  for (const scope of documentTypeScopes) {
    if (scope.allSubtypes && scope.subtypeIds.length > 0) {
      return NextResponse.json({ message: "Choose all subtypes or specific subtypes for each document type." }, { status: 400 });
    }
    if (!scope.allSubtypes && scope.subtypeIds.length === 0) {
      return NextResponse.json({ message: "Select at least one subtype or choose all subtypes." }, { status: 400 });
    }
    if (scope.subtypeIds.some((id) => subtypeTypeById.get(id) !== scope.documentTypeId)) {
      return NextResponse.json({ message: "A selected subtype does not belong to its document type." }, { status: 400 });
    }
  }

  try {
    await prisma.userAssignment.create({
      data: {
        userId,
        roleId,
        companyId,
        locationId,
        projectScopes: {
          create: projectIds.map((id) => ({ project: { connect: { id } } })),
        },
        documentTypeScopes: {
          create: documentTypeScopes.map((scope) => ({
            documentType: { connect: { id: scope.documentTypeId } },
            allSubtypes: scope.allSubtypes,
            subtypes: {
              create: scope.subtypeIds.map((id) => ({ documentSubtype: { connect: { id } } })),
            },
          })),
        },
        processScopes: {
          create: processDefinitionIds.map((id) => ({ processDefinition: { connect: { id } } })),
        },
      },
      select: { id: true },
    });
    return NextResponse.json({ message: "Role assigned." }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, {
      duplicate: "This user already holds this role with exactly this scope.",
      reference: "One of the selected items (user, role or scope) does not exist.",
    }) ?? NextResponse.json({ message: "Unable to save the assignment." }, { status: 500 });
  }
}

function parseIds(value: unknown[]): string[] {
  return [...new Set(value.map(optionalId).filter((id): id is string => id !== null))];
}

function parseDocumentTypeScopes(body: Record<string, unknown> | null): Array<{
  documentTypeId: string;
  allSubtypes: boolean;
  subtypeIds: string[];
}> | null {
  if (!body) return null;
  if (Array.isArray(body.documentTypeScopes)) {
    const scopes: Array<{ documentTypeId: string; allSubtypes: boolean; subtypeIds: string[] }> = [];
    for (const value of body.documentTypeScopes) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const entry = value as Record<string, unknown>;
      if (typeof entry.allSubtypes !== "boolean" || !Array.isArray(entry.subtypeIds)) return null;
      const documentTypeId = optionalId(entry.documentTypeId);
      if (!documentTypeId) return null;
      scopes.push({ documentTypeId, allSubtypes: entry.allSubtypes, subtypeIds: parseIds(entry.subtypeIds) });
    }
    return scopes;
  }

  const documentTypeId = optionalId(body.documentTypeId);
  if (!documentTypeId) return [];
  const documentSubtypeId = optionalId(body.documentSubtypeId);
  return [{
    documentTypeId,
    allSubtypes: documentSubtypeId === null,
    subtypeIds: documentSubtypeId ? [documentSubtypeId] : [],
  }];
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Assignment id is required." }, { status: 400 });

  try {
    await prisma.userAssignment.delete({ where: { id } });
    return NextResponse.json({ message: "Assignment removed." });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to remove the assignment." }, { status: 500 });
  }
}
