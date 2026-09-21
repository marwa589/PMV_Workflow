import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appConfig } from "@/lib/env";

export const SESSION_COOKIE_NAME = "docflow_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

type SessionPayload = {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  roles: UserRole[];
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

    return parsed;
  } catch {
    return null;
  }
}

export function attachSessionCookie(
  response: NextResponse,
  user: { id: string; email: string; name: string; role: UserRole; roles?: UserRole[] },
  sessionVersion = 0,
): void {
  const roles = user.roles && user.roles.length > 0 ? Array.from(new Set(user.roles)) : [user.role];
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roles,
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
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        sessionVersion: true,
        roleAssignments: { select: { role: true } },
      },
    });

    if (!user) {
      return null;
    }

    const roles = Array.from(new Set([user.role, ...user.roleAssignments.map((assignment) => assignment.role)]));

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roles,
      sessionVersion: user.sessionVersion ?? payload.sessionVersion,
    };
  } catch {
    const fallbackUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        sessionVersion: true,
      },
    });

    if (!fallbackUser) {
      return null;
    }

    return {
      userId: fallbackUser.id,
      email: fallbackUser.email,
      name: fallbackUser.name,
      role: fallbackUser.role,
      roles: [fallbackUser.role],
      sessionVersion: fallbackUser.sessionVersion ?? payload.sessionVersion,
    };
  }
}

export function getSessionFromToken(token: string | undefined): AuthSession | null {
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  return {
    userId: payload.userId,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    roles: payload.roles ?? [payload.role],
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
