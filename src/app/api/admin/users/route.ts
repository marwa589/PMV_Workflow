// src/app/api/admin/users/route.ts
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deactivationConfirmationResponse, optionalId, prismaErrorResponse, readJsonBody, requireApiPermission, str } from "@/lib/admin-api";

export const runtime = "nodejs";

const userSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  canBulkApprove: true,
  createdAt: true,
  userType: { select: { id: true, code: true, name: true } },
  _count: { select: { assignments: true } },
} as const;

type UserRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  canBulkApprove: boolean;
  createdAt: Date;
  userType: { id: string; code: string; name: string };
  _count: { assignments: number };
};

function serializeUser(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    canBulkApprove: user.canBulkApprove,
    userType: user.userType,
    assignmentCount: user._count.assignments,
    createdAt: user.createdAt.toISOString(),
  };
}

function passwordProblem(password: string): string | null {
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
    return "Password must be at least 12 characters and include a letter, number, and special character.";
  }
  return null;
}

// Users and their fixed user type. Roles and scopes are managed in /api/admin/assignments.
export async function GET(request: Request) {
  const auth = await requireApiPermission(request, "users.manage");
  if (auth.response) return auth.response;

  const [users, userTypes] = await Promise.all([
    prisma.user.findMany({ select: userSelect, orderBy: [{ name: "asc" }, { createdAt: "desc" }] }),
    prisma.userType.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return NextResponse.json({ users: users.map(serializeUser), userTypes });
}

export async function POST(request: Request) {
  const auth = await requireApiPermission(request, "users.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const name = str(body?.name);
  const email = str(body?.email).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  const userTypeId = optionalId(body?.userTypeId);

  if (!name || !email || !password || !userTypeId) {
    return NextResponse.json({ message: "Name, email, password and user type are required." }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ message: problem }, { status: 400 });

  const userType = await prisma.userType.findUnique({ where: { id: userTypeId }, select: { id: true } });
  if (!userType) return NextResponse.json({ message: "Selected user type does not exist." }, { status: 400 });

  try {
    const user = await prisma.user.create({
      data: { name, email, userTypeId, passwordHash: await hash(password, 12) },
      select: userSelect,
    });
    return NextResponse.json({ user: serializeUser(user) }, { status: 201 });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A user with this email already exists." })
      ?? NextResponse.json({ message: "Unable to create the user." }, { status: 500 });
  }
}

// A user's type is set once when the account is created and never changes.
export async function PATCH(request: Request) {
  const auth = await requireApiPermission(request, "users.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  const name = str(body?.name);
  const email = str(body?.email).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";

  if (!id || !name || !email) {
    return NextResponse.json({ message: "User id, name and email are required." }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  if (password) {
    const problem = passwordProblem(password);
    if (problem) return NextResponse.json({ message: problem }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { id }, select: { userTypeId: true, isActive: true } });
  if (!existing) return NextResponse.json({ message: "User not found." }, { status: 404 });

  const requestedType = optionalId(body?.userTypeId);
  if (requestedType && requestedType !== existing.userTypeId) {
    return NextResponse.json({ message: "A user's type cannot be changed after the account is created." }, { status: 400 });
  }

  const isActive = typeof body?.isActive === "boolean" ? body.isActive : undefined;
  const canBulkApprove = typeof body?.canBulkApprove === "boolean" ? body.canBulkApprove : undefined;
  if (isActive === false && id === auth.session.userId) {
    return NextResponse.json({ message: "You cannot deactivate your own account." }, { status: 400 });
  }

  try {
    if (isActive === false && existing.isActive) {
      const usage = await prisma.user.findUnique({
        where: { id },
        select: {
          _count: {
            select: {
              assignments: true,
              createdDocuments: true,
              approvalHistory: true,
              approvalsOnBehalfOf: true,
              workflowStepApprovals: true,
              approvalStepApprovals: true,
              delegationsGiven: true,
              delegationsReceived: true,
              processInstancesStarted: true,
            },
          },
        },
      });
      const confirmation = deactivationConfirmationResponse(body, "This user account", [
        { label: "role assignment(s)", count: usage?._count.assignments ?? 0 },
        { label: "document(s) created", count: usage?._count.createdDocuments ?? 0 },
        { label: "approval record(s)", count: (usage?._count.approvalHistory ?? 0) + (usage?._count.approvalsOnBehalfOf ?? 0) },
        { label: "flow approver assignment(s)", count: (usage?._count.workflowStepApprovals ?? 0) + (usage?._count.approvalStepApprovals ?? 0) },
        { label: "delegation(s)", count: (usage?._count.delegationsGiven ?? 0) + (usage?._count.delegationsReceived ?? 0) },
        { label: "process run(s) started", count: usage?._count.processInstancesStarted ?? 0 },
      ], "Deactivating blocks sign-in and preserves their records. Reassign any pending approvals they can no longer perform.");
      if (confirmation) return confirmation;
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        name,
        email,
        ...(isActive !== undefined ? { isActive } : {}),
        ...(canBulkApprove !== undefined ? { canBulkApprove } : {}),
        // A new password signs the user out everywhere.
        ...(password ? { passwordHash: await hash(password, 12), sessionVersion: { increment: 1 } } : {}),
      },
      select: userSelect,
    });
    return NextResponse.json({ user: serializeUser(user) });
  } catch (error) {
    return prismaErrorResponse(error, { duplicate: "A user with this email already exists." })
      ?? NextResponse.json({ message: "Unable to update the user." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiPermission(request, "users.manage");
  if (auth.response) return auth.response;

  const body = await readJsonBody(request);
  const id = str(body?.id);
  if (!id) return NextResponse.json({ message: "User id is required." }, { status: 400 });
  if (id === auth.session.userId) return NextResponse.json({ message: "You cannot delete your own account." }, { status: 400 });

  try {
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ message: "User deleted." });
  } catch (error) {
    return prismaErrorResponse(error, {
      reference: "This user has related workflow records and cannot be deleted. Deactivate the account instead.",
    }) ?? NextResponse.json({ message: "Unable to delete the user." }, { status: 500 });
  }
}
