import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestOrigin } from "@/lib/request-origin";
import { sendEmail } from "@/lib/mail";
import { appConfig } from "@/lib/env";

const RESPONSE_MESSAGE =
  "If an account exists for that email and password recovery is available, a reset link will be sent.";

function acceptedResponse() {
  return NextResponse.json(
    { message: RESPONSE_MESSAGE },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // Only allow requests originating from this application.
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
    !("email" in body) ||
    typeof body.email !== "string"
  ) {
    return NextResponse.json(
      { message: "Enter a valid email address." },
      { status: 400 },
    );
  }

  const email = body.email.trim().toLowerCase();

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return NextResponse.json(
      { message: "Enter a valid email address." },
      { status: 400 },
    );
  }

  // Recovery stays inactive until email delivery is enabled.
  if (!appConfig.passwordResetEmailEnabled()) {
    return acceptedResponse();
  }

  // Do not create tokens if SMTP is not configured.
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    return acceptedResponse();
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (!user) {
      return acceptedResponse();
    }

    // Basic per-account cooldown between reset emails.
    const recentRequest = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: {
          gte: new Date(Date.now() - 60 * 1000),
        },
      },
      select: { id: true },
    });

    if (recentRequest) {
      return acceptedResponse();
    }

    const token = randomBytes(32).toString("hex");

    const tokenHash = createHash("sha256")
      .update(token)
      .digest("hex");

    const resetRecord = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const resetUrl = new URL("/reset-password", expectedOrigin);
    resetUrl.searchParams.set("token", token);

    try {
      const delivery = await sendEmail({
        to: user.email,
        subject: "Reset your PMV Workflow password",
        html: `
          <p>A password reset was requested for your account.</p>
          <p>
            <a href="${resetUrl.toString()}">Reset your password</a>
          </p>
          <p>This link expires in 30 minutes and can be used once.</p>
          <p>
            If you did not request this, you can ignore this email.
          </p>
        `,
      });

      if (!delivery) {
        throw new Error("Email delivery is unavailable.");
      }
    } catch {
      // Remove this new token if sending failed.
      await prisma.passwordResetToken.deleteMany({
        where: { id: resetRecord.id },
      });
    }

    return acceptedResponse();
  } catch {
    // Do not expose account details or internal errors.
    console.error("Password reset request could not be completed.");
    return acceptedResponse();
  }
}