import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appConfig } from "@/lib/env";
import { isUserTypeCode, type UserTypeCode } from "@/lib/auth/roles";

export const SESSION_COOKIE_NAME = "docflow_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

type SessionPayload = {
  userId: string;
  email: string;
  name: string;
  userType: UserTypeCode;
  sessionVersion: number;
  exp: number;
};

export type AuthSession = Omit<SessionPayload, "exp">;

function getAuthSecret(): string {
  return appConfig.authSecret();
}

function sign(value: string): string {
  return createHmac("sha256", getAuthSecret()).update(value).digest("base64url");
}

function createToken(payload: SessionPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyToken(token: string): SessionPayload | null {
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return null;

  const expectedSignature = sign(encodedPayload);
  const provided = Buffer.from(encodedSignature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionPayload;

    if (!parsed.exp || Date.now() > parsed.exp * 1000) {
      return null;
    }
    if (!isUserTypeCode(parsed.userType)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function attachSessionCookie(
  response: NextResponse,
  user: { id: string; email: string; name: string; userType: UserTypeCode },
  sessionVersion = 0,
): void {
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    userType: user.userType,
    sessionVersion,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  const token = createToken(payload);

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      sessionVersion: true,
      userType: { select: { code: true } },
    },
  });

  // Deactivated users lose access immediately, even with a valid cookie.
  if (!user || !user.isActive) return null;
  if (!isUserTypeCode(user.userType.code)) return null;

  // A password change or reset raises the user's sessionVersion, which signs out every session opened before it.
  if ((payload.sessionVersion ?? 0) !== user.sessionVersion) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    userType: user.userType.code,
    sessionVersion: user.sessionVersion ?? payload.sessionVersion,
  };
}

export function getSessionFromToken(token: string | undefined): AuthSession | null {
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  return {
    userId: payload.userId,
    email: payload.email,
    name: payload.name,
    userType: payload.userType,
    sessionVersion: payload.sessionVersion,
  };
}

export async function rotateSession(userId: string): Promise<number> {
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });

  return updatedUser.sessionVersion;
}

export async function revokeUserSessions(userId: string): Promise<number> {
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });

  return updatedUser.sessionVersion;
}
