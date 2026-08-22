import "server-only";

import { createHash, randomBytes, randomInt } from "crypto";
import { compare, hash as hashPassword } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { writeAuditLog } from "@/lib/audit";

export const OTP_CHALLENGE_COOKIE = "docflow_otp_challenge";
export const TRUSTED_DEVICE_COOKIE = "docflow_trusted_device";

const OTP_TTL_MS = 5 * 60 * 1000;
const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_CHALLENGES_PER_WINDOW = 5;
const CHALLENGE_WINDOW_MS = 15 * 60 * 1000;

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function createOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function createAdminOtpChallenge(user: { id: string; email: string; name: string }) {
  const windowStart = new Date(Date.now() - CHALLENGE_WINDOW_MS);
  const recentChallenges = await prisma.otpChallenge.count({
    where: { userId: user.id, createdAt: { gte: windowStart } },
  });

  if (recentChallenges >= MAX_CHALLENGES_PER_WINDOW) {
    throw new Error("Too many OTP requests. Please try again later.");
  }

  const code = createOtpCode();
  const challengeToken = createOpaqueToken();

  await prisma.otpChallenge.deleteMany({
    where: { userId: user.id, consumedAt: null },
  });

  await prisma.otpChallenge.create({
    data: {
      userId: user.id,
      challengeTokenHash: hashToken(challengeToken),
      codeHash: await hashPassword(code, 10),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  await sendEmail({
    to: user.email,
    subject: "Your PMV Workflow verification code",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <p>Hello ${user.name || "Admin"},</p>
        <p>Use this one-time verification code to sign in:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 8px;">${code}</p>
        <p>This code expires in 5 minutes and can only be used once.</p>
        <p>If you did not try to sign in, secure your account immediately.</p>
      </div>
    `,
  });

  await writeAuditLog({
    performedById: user.id,
    action: "OTP_SENT",
    details: JSON.stringify({ method: "email", expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString() }),
  });

  return challengeToken;
}

export async function verifyAdminOtp(challengeToken: string, code: string) {
  const challenge = await prisma.otpChallenge.findUnique({
    where: { challengeTokenHash: hashToken(challengeToken) },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });

  if (!challenge || challenge.consumedAt || challenge.verifiedAt) {
    throw new Error("This OTP challenge is no longer valid.");
  }

  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new Error("This OTP has expired. Please sign in again.");
  }

  if (challenge.lockedUntil && challenge.lockedUntil.getTime() > Date.now()) {
    throw new Error("Too many incorrect OTP attempts. Please try again later.");
  }

  if (!/^\d{6}$/.test(code) || !(await compare(code, challenge.codeHash))) {
    const attempts = challenge.attempts + 1;
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts,
        lockedUntil: attempts >= MAX_OTP_ATTEMPTS ? new Date(Date.now() + OTP_LOCKOUT_MS) : null,
      },
    });
    await writeAuditLog({
      performedById: challenge.userId,
      action: "OTP_VERIFICATION_FAILED",
      details: JSON.stringify({ attempts, locked: attempts >= MAX_OTP_ATTEMPTS }),
    });
    throw new Error(attempts >= MAX_OTP_ATTEMPTS
      ? "Too many incorrect OTP attempts. Please try again later."
      : "Invalid OTP.");
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { verifiedAt: new Date() },
  });

  await writeAuditLog({
    performedById: challenge.userId,
    action: "OTP_VERIFIED",
    details: JSON.stringify({ method: "email", attempts: challenge.attempts + 1 }),
  });

  return { challengeId: challenge.id, user: challenge.user };
}

export async function completeAdminOtpLogin(challengeToken: string, rememberDevice: boolean) {
  const challenge = await prisma.otpChallenge.findUnique({
    where: { challengeTokenHash: hashToken(challengeToken) },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });

  if (!challenge || challenge.consumedAt || !challenge.verifiedAt || challenge.expiresAt.getTime() <= Date.now()) {
    throw new Error("OTP verification has expired. Please sign in again.");
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  });

  let trustedDeviceToken: string | null = null;
  if (rememberDevice) {
    trustedDeviceToken = createOpaqueToken();
    await prisma.trustedDevice.create({
      data: {
        userId: challenge.userId,
        tokenHash: hashToken(trustedDeviceToken),
        expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS),
      },
    });

    await writeAuditLog({
      performedById: challenge.userId,
      action: "TRUSTED_DEVICE_CREATED",
      details: JSON.stringify({ expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS).toISOString() }),
    });
  }

  return { user: challenge.user, trustedDeviceToken };
}

export async function getValidTrustedDevice(userId: string, token: string | undefined) {
  if (!token) return null;

  const device = await prisma.trustedDevice.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!device || device.userId !== userId || device.revokedAt || device.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  await prisma.trustedDevice.update({
    where: { id: device.id },
    data: { lastUsedAt: new Date() },
  });

  return device;
}

export async function revokeTrustedDevices(userId: string, performedById = userId) {
  const result = await prisma.trustedDevice.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await writeAuditLog({
    performedById,
    action: "TRUSTED_DEVICES_REVOKED",
    details: JSON.stringify({ userId, count: result.count }),
  });

  return result.count;
}

export function setTrustedDeviceCookie(response: { cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void } }, token: string) {
  response.cookies.set(TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: TRUSTED_DEVICE_TTL_MS / 1000,
  });
}

export function clearOtpChallengeCookie(response: { cookies: { set: (name: string, value: string, options: Record<string, unknown>) => void } }) {
  response.cookies.set(OTP_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
