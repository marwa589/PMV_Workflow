import { NextResponse } from "next/server";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { attachSessionCookie, rotateSession } from "@/lib/auth/session";
import {
  clearOtpChallengeCookie,
  completeAdminOtpLogin,
  OTP_CHALLENGE_COOKIE,
  setTrustedDeviceCookie,
} from "@/lib/auth/otp";

function getCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie")?.split(";").find((entry) => entry.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rememberDevice?: boolean };
    const challengeToken = getCookie(request, OTP_CHALLENGE_COOKIE);

    if (!challengeToken) {
      return NextResponse.json({ message: "OTP verification has expired. Please sign in again." }, { status: 401 });
    }

    const result = await completeAdminOtpLogin(challengeToken, body.rememberDevice === true);
    const rotatedVersion = await rotateSession(result.user.id);
    const response = NextResponse.json({
      message: "Login successful.",
      role: result.user.role,
      redirectTo: getDefaultRouteForRole(result.user.role),
    });

    attachSessionCookie(response, result.user, rotatedVersion);
    clearOtpChallengeCookie(response);
    if (result.trustedDeviceToken) {
      setTrustedDeviceCookie(response, result.trustedDeviceToken);
    }

    return response;
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to complete login." },
      { status: 401 },
    );
  }
}
