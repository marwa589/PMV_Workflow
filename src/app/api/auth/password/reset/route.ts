import { createHash } from "crypto";
import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestOrigin } from "@/lib/request-origin";
import { clearSessionCookie } from "@/lib/auth/session";
import {
  OTP_CHALLENGE_COOKIE,
  TRUSTED_DEVICE_COOKIE,
} from "@/lib/auth/otp";

const INVALID_LINK_MESSAGE =
  "This reset link is invalid or has expired. Request a new link.";

function invalidLinkResponse() {
  return NextResponse.json(
    { message: INVALID_LINK_MESSAGE },
    {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  try {
    const expectedOrigin = getRequestOrigin(request);

    if (request.headers.get("origin") !== expectedOrigin) {
      return NextResponse.json(
        { message: "Request origin is not allowed." },
        { status: 403 },
      );
    }

    const body: unknown = await request.json().catch(() => null);

    if (
      !body ||
      typeof body !== "object" ||
      !("token" in body) ||
      !("newPassword" in body) ||
      typeof body.token !== "string" ||
      typeof body.newPassword !== "string"
    ) {
      return NextResponse.json(
        { message: "A reset token and new password are required." },
        { status: 400 },
      );
    }

    const { token, newPassword } = body;

    // Our reset tokens are 32 random bytes represented as 64 hex characters.
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return invalidLinkResponse();
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
            "Use at least 12 characters, including a letter, a number and a special character.",
        },
        { status: 400 },
      );
    }

    // bcrypt only uses the first 72 bytes of a password.
    if (Buffer.byteLength(newPassword, "utf8") > 72) {
      return NextResponse.json(
        {
          message:
            "The password is too long. Use no more than 72 UTF-8 bytes.",
        },
        { status: 400 },
      );
    }

    const tokenHash = createHash("sha256")
      .update(token)
      .digest("hex");

    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
      },
    });

    if (
      !resetRecord ||
      resetRecord.usedAt ||
      resetRecord.expiresAt.getTime() <= Date.now()
    ) {
      return invalidLinkResponse();
    }

    const passwordHash = await hash(newPassword, 12);

    await prisma.$transaction(async (tx) => {
      const now = new Date();

      // Claim the token only if it is still unused and unexpired.
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: resetRecord.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          usedAt: now,
        },
      });

      if (claimed.count !== 1) {
        throw new Error("INVALID_RESET_TOKEN");
      }

      // Save the password and invalidate all old login sessions.
      await tx.user.update({
        where: { id: resetRecord.userId },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
        },
      });

      // Require OTP again on previously remembered devices.
      await tx.trustedDevice.updateMany({
        where: {
          userId: resetRecord.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      // Cancel OTP challenges started before this password reset.
      await tx.otpChallenge.deleteMany({
        where: { userId: resetRecord.userId },
      });

      // Cancel any other reset links for the account.
      await tx.passwordResetToken.deleteMany({
        where: {
          userId: resetRecord.userId,
          id: { not: resetRecord.id },
        },
      });
    });

    const response = NextResponse.json(
      {
        message: "Password reset successfully. Please sign in.",
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );

    clearSessionCookie(response);

    for (const cookieName of [
      OTP_CHALLENGE_COOKIE,
      TRUSTED_DEVICE_COOKIE,
    ]) {
      response.cookies.set(cookieName, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 0,
      });
    }

    return response;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "INVALID_RESET_TOKEN"
    ) {
      return invalidLinkResponse();
    }

    console.error("Password reset could not be completed.");

    return NextResponse.json(
      { message: "Unable to reset your password. Please try again." },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}