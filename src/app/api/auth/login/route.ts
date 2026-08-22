import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { attachSessionCookie, rotateSession } from "@/lib/auth/session";
import {
  createAdminOtpChallenge,
  getValidTrustedDevice,
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
    });

    if (!user) {
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    const isValidPassword = await compare(password, user.passwordHash);
    if (!isValidPassword) {
      return NextResponse.json({ message: "Invalid credentials." }, { status: 401 });
    }

    if (user.role === "ADMIN") {
      const trustedDevice = await getValidTrustedDevice(user.id, getCookie(request, TRUSTED_DEVICE_COOKIE));
      if (!trustedDevice) {
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
      }
    }

    const rotatedVersion = await rotateSession(user.id);
    const redirectTo = getDefaultRouteForRole(user.role);
    const response = NextResponse.json({
      message: "Login successful.",
      role: user.role,
      redirectTo,
    });

    attachSessionCookie(response, {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }, rotatedVersion);

    return response;
  } catch {
    return NextResponse.json({ message: "Unable to login." }, { status: 500 });
  }
}
