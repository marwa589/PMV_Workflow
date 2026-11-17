// src/app/api/admin/assignments/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { optionalId, prismaErrorResponse, readJsonBody, requireApiAdmin, str } from "@/lib/admin-api";

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
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  role: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, name: true } },
  documentType: { select: { id: true, code: true, name: true } },
  documentSubtype: { select: { id: true, code: true, name: true, documentTypeId: true } },
  projectScopes: { select: { project: { select: { id: true, code: true, name: true } } } },
  documentTypeScopes: {
    select: {
      documentType: { select: { id: true, code: true, name: true } },
      allSubtypes: true,
      subtypes: { select: { documentSubtype: { select: { id: true, code: true, name: true } } } },
    },
  },
} as const;

/**
 * One assignment can contain multiple values in each scope dimension. Empty scope lists mean no
 * restriction, while each selected document type independently has an all-subtypes or selected-subtypes scope.
 */
export async function GET(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;

  const userId = new URL(request.url).searchParams.get("userId")?.trim();

  const [storedAssignments, users, roles, companyRows, projects, locations, documentTypes] = await Promise.all([
    prisma.userAssignment.findMany({ where: userId ? { userId } : {}, select: assignmentSelect, orderBy: [{ user: { name: "asc" } }, { createdAt: "asc" }] }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, userType: { select: { code: true, name: true } } }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // A role given for a company covers the projects that belong to it (set in Projects & Locations).
    prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true, _count: { select: { projects: true } } }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.documentType.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, subtypes: { where: { isActive: true }, select: { id: true, code: true, name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  const companies = companyRows.map((company) => ({ id: company.id, name: company.name, projectCount: company._count.projects }));

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

    return {
      id: assignment.id,
      user: assignment.user,
      role: assignment.role,
      company: assignment.company,
      location: assignment.location,
      projects: [...projectById.values()],
      documentTypeScopes: [...typeScopes.values()],
    };
  });

  return NextResponse.json({ assignments, users, roles, companies, projects, locations, documentTypes });
}

type AssignmentInput = {
  userId: string;
  roleId: string;
  companyId: string | null;
  locationId: string | null;
  projectIds: string[];
  documentTypeScopes: Array<{ documentTypeId: string; allSubtypes: boolean; subtypeIds: string[] }>;
};

/** Reads and checks the user, role and scope of an assignment (shared by assigning and editing). */
async function parseAssignmentInput(body: Record<string, unknown> | null): Promise<{ input: AssignmentInput } | { response: NextResponse }> {
  const userId = optionalId(body?.userId);
  const roleId = optionalId(body?.roleId);
  const projectIds = body && Array.isArray(body.projectIds)
    ? parseIds(body.projectIds)
    : parseIds([body?.projectId]);
  const documentTypeScopes = parseDocumentTypeScopes(body);
  const companyId = optionalId(body?.companyId);
  const locationId = optionalId(body?.locationId);

  if (!userId || !roleId) return { response: NextResponse.json({ message: "User and role are required." }, { status: 400 }) };

  if (!documentTypeScopes) {
    return { response: NextResponse.json({ message: "Each document type needs a valid subtype selection." }, { status: 400 }) };
  }

  const subtypeIds = documentTypeScopes.flatMap((scope) => scope.subtypeIds);
  const [validProjects, validCompany, validTypes, validSubtypes] = await Promise.all([
    prisma.project.count({ where: { id: { in: projectIds }, isActive: true } }),
    companyId ? prisma.company.count({ where: { id: companyId, isActive: true } }) : Promise.resolve(1),
    prisma.documentType.count({ where: { id: { in: documentTypeScopes.map((scope) => scope.documentTypeId) }, isActive: true } }),
    prisma.documentSubtype.findMany({
      where: { id: { in: subtypeIds }, isActive: true },
      select: { id: true, documentTypeId: true },
    }),
  ]);
  if (validProjects !== projectIds.length) return { response: NextResponse.json({ message: "One or more selected projects are unavailable." }, { status: 400 }) };
  if (validCompany !== 1) return { response: NextResponse.json({ message: "The selected company is unavailable." }, { status: 400 }) };
  if (validTypes !== documentTypeScopes.length) return { response: NextResponse.json({ message: "One or more selected document types are unavailable." }, { status: 400 }) };
  if (validSubtypes.length !== subtypeIds.length) return { response: NextResponse.json({ message: "One or more selected subtypes are unavailable." }, { status: 400 }) };

  const subtypeTypeById = new Map(validSubtypes.map((subtype) => [subtype.id, subtype.documentTypeId]));
  for (const scope of documentTypeScopes) {
    if (scope.allSubtypes && scope.subtypeIds.length > 0) {
      return { response: NextResponse.json({ message: "Choose all subtypes or specific subtypes for each document type." }, { status: 400 }) };
    }
    if (!scope.allSubtypes && scope.subtypeIds.length === 0) {
      return { response: NextResponse.json({ message: "Select at least one subtype or choose all subtypes." }, { status: 400 }) };
    }
    if (scope.subtypeIds.some((id) => subtypeTypeById.get(id) !== scope.documentTypeId)) {
      return { response: NextResponse.json({ message: "A selected subtype does not belong to its document type." }, { status: 400 }) };
    }
  }

  return { input: { userId, roleId, companyId, locationId, projectIds, documentTypeScopes } };
}

export async function POST(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;

  const parsed = await parseAssignmentInput(await readJsonBody(request));
  if ("response" in parsed) return parsed.response;
  const { userId, roleId, companyId, locationId, projectIds, documentTypeScopes } = parsed.input;

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

// Edit an assigned role: the role and every part of its scope can change (the person stays the same).
// The old scope is replaced as a whole, so what is saved is exactly what the form shows.
export async function PATCH(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  if (!id) return NextResponse.json({ message: "Assignment id is required." }, { status: 400 });

  const existing = await prisma.userAssignment.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!existing) return NextResponse.json({ message: "This assignment no longer exists." }, { status: 404 });

  const parsed = await parseAssignmentInput({ ...body, userId: existing.userId });
  if ("response" in parsed) return parsed.response;
  const { roleId, companyId, locationId, projectIds, documentTypeScopes } = parsed.input;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.userAssignmentProjectScope.deleteMany({ where: { userAssignmentId: id } });
      await tx.userAssignmentDocumentTypeScope.deleteMany({ where: { userAssignmentId: id } });
      await tx.userAssignment.update({
        where: { id },
        data: {
          roleId,
          companyId,
          locationId,
          // Older assignments kept one project / type in these columns; the scope lists now hold everything.
          projectId: null,
          documentTypeId: null,
          documentSubtypeId: null,
          projectScopes: { create: projectIds.map((projectId) => ({ project: { connect: { id: projectId } } })) },
          documentTypeScopes: {
            create: documentTypeScopes.map((scope) => ({
              documentType: { connect: { id: scope.documentTypeId } },
              allSubtypes: scope.allSubtypes,
              subtypes: { create: scope.subtypeIds.map((subtypeId) => ({ documentSubtype: { connect: { id: subtypeId } } })) },
            })),
          },
        },
      });
    });
    return NextResponse.json({ message: "Assignment updated." });
  } catch (error) {
    return prismaErrorResponse(error, {
      duplicate: "This user already holds this role with exactly this scope.",
      reference: "One of the selected items (role or scope) does not exist.",
    }) ?? NextResponse.json({ message: "Unable to update the assignment." }, { status: 500 });
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
  const auth = await requireApiAdmin(request);
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
