// src/app/api/admin/roles/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const roleSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  permissions: { select: { permission: { select: { id: true, code: true, name: true, description: true } } } },
  _count: { select: { assignments: true } },
} as const;

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  permissions: Array<{ permission: { id: string; code: string; name: string; description: string | null } }>;
  _count: { assignments: number };
};

function serializeRole(role: RoleRow) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    createdAt: role.createdAt.toISOString(),
    assignmentCount: role._count.assignments,
    permissions: role.permissions.map((entry) => entry.permission).sort((a, b) => a.code.localeCompare(b.code)),
  };
}

async function validPermissionIds(raw: unknown): Promise<{ ids?: string[]; error?: string }> {
  if (raw === undefined) return { ids: [] };
  if (!Array.isArray(raw)) return { error: "Permissions must be a list." };
  const ids = [...new Set(raw.map((value) => String(value)))];
  const found = ids.length ? await prisma.permission.count({ where: { id: { in: ids } } }) : 0;
  if (found !== ids.length) return { error: "One of the selected permissions does not exist." };
  return { ids };
}

// A role is a named bundle of permissions. The Approver role has none by design.
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({ select: roleSelect, orderBy: { name: "asc" } }),
    prisma.permission.findMany({ select: { id: true, code: true, name: true, description: true }, orderBy: { code: "asc" } }),
  ]);
  return NextResponse.json({ roles: roles.map(serializeRole), permissions });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const name = str(body?.name);
  if (!name) return NextResponse.json({ message: "Role name is required." }, { status: 400 });

  const permissions = await validPermissionIds(body?.permissionIds);
  if (permissions.error || !permissions.ids) return NextResponse.json({ message: permissions.error }, { status: 400 });

  try {
    const role = await prisma.role.create({
      data: {
        name,
        description: str(body?.description) || null,
        permissions: { create: permissions.ids.map((permissionId) => ({ permissionId })) },
      },
      select: roleSelect,
    });
    return NextResponse.json({ role: serializeRole(role) }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A role with this name already exists." })
      ?? NextResponse.json({ message: "Unable to create the role." }, { status: 500 });
  }
}

// Replaces the role's name, description and permission list.
export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const name = str(body?.name);
  if (!id || !name) return NextResponse.json({ message: "Role id and name are required." }, { status: 400 });

  const permissions = await validPermissionIds(body?.permissionIds);
  if (permissions.error || !permissions.ids) return NextResponse.json({ message: permissions.error }, { status: 400 });

  try {
    const role = await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      return tx.role.update({
        where: { id },
        data: {
          name,
          description: str(body?.description) || null,
          permissions: { create: (permissions.ids as string[]).map((permissionId) => ({ permissionId })) },
        },
        select: roleSelect,
      });
    });
    return NextResponse.json({ role: serializeRole(role) });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A role with this name already exists." })
      ?? NextResponse.json({ message: "Unable to update the role." }, { status: 500 });
  }
}

// A role that people still hold cannot be deleted (their access would disappear silently).
export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "assignments.manage");
  if (auth.response) return auth.response;

  const id = str((await readJsonBody(request))?.id);
  if (!id) return NextResponse.json({ message: "Role id is required." }, { status: 400 });

  const assignments = await prisma.userAssignment.count({ where: { roleId: id } });
  if (assignments > 0) return NextResponse.json({ message: `This role is held through ${assignments} assignment(s). Remove those first.` }, { status: 409 });

  try {
    await prisma.role.delete({ where: { id } });
    return NextResponse.json({ message: "Role deleted." });
  } catch (error) {
    return prismaErrorResponse(error) ?? NextResponse.json({ message: "Unable to delete the role." }, { status: 500 });
  }
}
