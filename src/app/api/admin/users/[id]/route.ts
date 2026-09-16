import { UserRole } from "@prisma/client";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { revokeUserSessions } from "@/lib/auth/session";
import { revokeTrustedDevices } from "@/lib/auth/otp";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const roleValues = new Set(Object.values(UserRole));

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && roleValues.has(value as UserRole);
}

async function getAdminSession(request: Request) {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };
  if (session.role !== UserRole.ADMIN) return { response: NextResponse.json({ message: "Only Admin can manage users." }, { status: 403 }) };
  if (!validateCsrf(request)) return { response: NextResponse.json({ message: "CSRF validation failed." }, { status: 403 }) };
  return { session };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAdminSession(request);
  if (auth.response) return auth.response;
  const session = auth.session;
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    isActive?: boolean;
  };

  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ message: "User not found." }, { status: 404 });

  const name = body.name?.trim() ?? current.name;
  const email = body.email?.trim().toLowerCase() ?? current.email;
  const nextRole = body.role === undefined ? current.role : body.role;
  const nextIsActive = body.isActive === undefined ? current.isActive : body.isActive;

  if (name.length < 2 || name.length > 100) return NextResponse.json({ message: "Name must be between 2 and 100 characters." }, { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return NextResponse.json({ message: "A valid email address is required." }, { status: 400 });
  if (!isUserRole(nextRole)) return NextResponse.json({ message: "A valid user role is required." }, { status: 400 });
  if (typeof nextIsActive !== "boolean") return NextResponse.json({ message: "Active status must be boolean." }, { status: 400 });
  if (body.password !== undefined && body.password !== "" && body.password.length < 12) {
    return NextResponse.json({ message: "Password must be at least 12 characters." }, { status: 400 });
  }
  if (id === session.userId && (nextRole !== UserRole.ADMIN || !nextIsActive)) {
    return NextResponse.json({ message: "You cannot remove or deactivate your own admin access." }, { status: 400 });
  }

  if (current.role === UserRole.ADMIN && current.isActive && (nextRole !== UserRole.ADMIN || !nextIsActive)) {
    const activeAdminCount = await prisma.user.count({ where: { role: UserRole.ADMIN, isActive: true } });
    if (activeAdminCount <= 1) return NextResponse.json({ message: "At least one active admin must remain." }, { status: 400 });
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        name,
        email,
        role: nextRole,
        isActive: nextIsActive,
        ...(body.password ? { passwordHash: await hash(body.password, 12) } : {}),
      },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });

    if (body.password || current.role !== user.role || current.isActive !== user.isActive) {
      await revokeUserSessions(id);
      await revokeTrustedDevices(id, session.userId);
    }
    await writeAuditLog({
      performedById: session.userId,
      action: "USER_UPDATED",
      details: JSON.stringify({ userId: id, email: user.email, role: user.role, isActive: user.isActive, passwordReset: Boolean(body.password) }),
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json({ message: "A user with that email already exists." }, { status: 409 });
    }
    return NextResponse.json({ message: "Unable to update user." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAdminSession(request);
  if (auth.response) return auth.response;
  const session = auth.session;
  const { id } = await params;

  if (id === session.userId) return NextResponse.json({ message: "You cannot deactivate your own account." }, { status: 400 });

  const current = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, isActive: true } });
  if (!current) return NextResponse.json({ message: "User not found." }, { status: 404 });
  if (!current.isActive) return NextResponse.json({ message: "User is already inactive." }, { status: 400 });

  if (current.role === UserRole.ADMIN) {
    const activeAdminCount = await prisma.user.count({ where: { role: UserRole.ADMIN, isActive: true } });
    if (activeAdminCount <= 1) return NextResponse.json({ message: "At least one active admin must remain." }, { status: 400 });
  }

  await prisma.user.update({ where: { id }, data: { isActive: false } });
  await revokeUserSessions(id);
  await revokeTrustedDevices(id, session.userId);
  await writeAuditLog({
    performedById: session.userId,
    action: "USER_DEACTIVATED",
    details: JSON.stringify({ userId: id, email: current.email, role: current.role }),
  });

  return NextResponse.json({ message: "User deactivated." });
}