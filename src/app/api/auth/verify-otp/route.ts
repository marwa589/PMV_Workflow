import { NextResponse } from "next/server";
import { OTP_CHALLENGE_COOKIE, verifyAdminOtp } from "@/lib/auth/otp";

function getCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie")?.split(";").find((entry) => entry.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { code?: string };
    const code = body.code?.trim() || "";
    const challengeToken = getCookie(request, OTP_CHALLENGE_COOKIE);

    if (!challengeToken || !code) {
      return NextResponse.json({ message: "Verification code is required." }, { status: 400 });
    }

    await verifyAdminOtp(challengeToken, code);
    return NextResponse.json({ message: "Code verified. Choose whether to remember this device.", otpVerified: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to verify code." },
      { status: 401 },
    );
  }
}
