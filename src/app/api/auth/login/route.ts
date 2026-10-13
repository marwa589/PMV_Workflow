// src/app/api/auth/login/route.ts
import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { getDefaultRouteForRole, isUserTypeCode } from "@/lib/auth/roles";
import { attachSessionCookie} from "@/lib/auth/session";
import {
  createAdminOtpChallenge,
  getValidTrustedDevice,
  isOtpAuthenticationEnabled,
  isOtpBypassedForDevice,
  isOtpRequiredForUser,
  OTP_CHALLENGE_COOKIE,
  TRUSTED_DEVICE_COOKIE,
} from "@/lib/auth/otp";
import { prisma } from "@/lib/prisma";

function getCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie")?.split(";").find((entry) => entry.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return NextResponse.json(
        { message: "Email and password are required." },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { userType: { select: { code: true } } },
    });

    // Same message for unknown, deactivated and wrong-password accounts.
    if (!user || !user.isActive || !isUserTypeCode(user.userType.code)) {
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }
    const userType = user.userType.code;

    const isValidPassword = await compare(password, user.passwordHash);
    if (!isValidPassword) {
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    if (isOtpAuthenticationEnabled() && isOtpRequiredForUser(user.email)) {
      const deviceBypassed = isOtpBypassedForDevice(request);
      const trustedDevice = await getValidTrustedDevice(user.id, getCookie(request, TRUSTED_DEVICE_COOKIE));

      if (!deviceBypassed && !trustedDevice) {
        try {
          const challengeToken = await createAdminOtpChallenge({
            id: user.id,
            email: user.email,
            name: user.name,
          });
          const response = NextResponse.json({
            message: "A verification code was sent to your email.",
            requiresOtp: true,
          });
          response.cookies.set(OTP_CHALLENGE_COOKIE, challengeToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            maxAge: 5 * 60,
          });
          return response;
        } catch (error) {
          return NextResponse.json(
            { message: error instanceof Error ? error.message : "OTP authentication is currently unavailable." },
            { status: 503 },
          );
        }
      }
    }

    // const rotatedVersion = await rotateSession(user.id);
    const redirectTo = getDefaultRouteForRole(userType);
    const response = NextResponse.json({
      message: "Login successful.",
      userType,
      redirectTo,
    });

    attachSessionCookie(response, {
      id: user.id,
      email: user.email,
      name: user.name,
      userType,
    }, user.sessionVersion);

    return response;
  } catch {
    return NextResponse.json({ message: "Unable to login." }, { status: 500 });
  }
}
