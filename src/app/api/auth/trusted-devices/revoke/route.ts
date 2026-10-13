// src/app/api/auth/trusted-devices/revoke/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { USER_TYPE } from "@/lib/auth/roles";
import { revokeTrustedDevices, TRUSTED_DEVICE_COOKIE } from "@/lib/auth/otp";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.userType !== USER_TYPE.ADMIN) {
    return NextResponse.json({ message: "Only an administrator can revoke trusted-device access." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { userId?: string };
  const userId = body.userId?.trim() || session.userId;
  const revokedCount = await revokeTrustedDevices(userId, session.userId);
  const response = NextResponse.json({ message: "Trusted-device access revoked.", revokedCount });

  if (userId === session.userId) {
    response.cookies.set(TRUSTED_DEVICE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}
