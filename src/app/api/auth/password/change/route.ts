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

  const body = (await request.json()) as { currentPassword?: string; newPassword?: string };
  const currentPassword = body.currentPassword || "";
  const newPassword = body.newPassword || "";

  if (!currentPassword || newPassword.length < 12) {
    return NextResponse.json({ message: "Current password and a new password of at least 12 characters are required." }, { status: 400 });
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
