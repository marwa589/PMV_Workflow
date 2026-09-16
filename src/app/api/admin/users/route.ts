import { UserRole } from "@prisma/client";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const roleValues = new Set(Object.values(UserRole));

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && roleValues.has(value as UserRole);
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (session.role !== UserRole.ADMIN) return NextResponse.json({ message: "Only Admin can manage users." }, { status: 403 });
  if (!validateCsrf(request)) return NextResponse.json({ message: "CSRF validation failed." }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { name?: string; email?: string; password?: string; role?: string };
  const name = body.name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  if (name.length < 2 || name.length > 100) {
    return NextResponse.json({ message: "Name must be between 2 and 100 characters." }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return NextResponse.json({ message: "A valid email address is required." }, { status: 400 });
  }
  if (password.length < 12) {
    return NextResponse.json({ message: "Password must be at least 12 characters." }, { status: 400 });
  }
  if (!isUserRole(body.role)) {
    return NextResponse.json({ message: "A valid user role is required." }, { status: 400 });
  }

  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash: await hash(password, 12), role: body.role },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });

    await writeAuditLog({
      performedById: session.userId,
      action: "USER_CREATED",
      details: JSON.stringify({ userId: user.id, email: user.email, role: user.role }),
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json({ message: "A user with that email already exists." }, { status: 409 });
    }
    return NextResponse.json({ message: "Unable to create user." }, { status: 500 });
  }
}