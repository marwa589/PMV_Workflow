import { compare, hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { getSession, clearSessionCookie, revokeUserSessions } from "@/lib/auth/session";
import { revokeTrustedDevices, TRUSTED_DEVICE_COOKIE } from "@/lib/auth/otp";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  
  const body: unknown = await request.json().catch(() => null);

if (
  !body ||
  typeof body !== "object" ||
  !("currentPassword" in body) ||
  !("newPassword" in body) ||
  typeof body.currentPassword !== "string" ||
  typeof body.newPassword !== "string"
) {
  return NextResponse.json(
    { message: "Current password and new password are required." },
    { status: 400 },
  );
}

const { currentPassword, newPassword } = body;

if (!currentPassword) {
  return NextResponse.json(
    { message: "Current password is required." },
    { status: 400 },
  );
}

if (
  newPassword.length < 12 ||
  !/[A-Za-z]/.test(newPassword) ||
  !/[0-9]/.test(newPassword) ||
  !/[^A-Za-z0-9\s]/.test(newPassword)
) {
  return NextResponse.json(
    {
      message:
        "Your new password must contain at least 12 characters, including a letter, a number and a special character.",
    },
    { status: 400 },
  );
}

if (newPassword === currentPassword) {
  return NextResponse.json(
    { message: "Choose a password different from your current password." },
    { status: 400 },
  );
}

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { passwordHash: true } });
  if (!user || !(await compare(currentPassword, user.passwordHash))) {
    return NextResponse.json({ message: "Current password is incorrect." }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: { passwordHash: await hash(newPassword, 12) },
  });
  await revokeUserSessions(session.userId);
  await revokeTrustedDevices(session.userId);
  await writeAuditLog({
    performedById: session.userId,
    action: "PASSWORD_CHANGED",
  });

  const response = NextResponse.json({ message: "Password changed. Please sign in again." });
  clearSessionCookie(response);
  response.cookies.set(TRUSTED_DEVICE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
