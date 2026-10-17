import "server-only";

import { NextResponse } from "next/server";
import { getSession, type AuthSession } from "@/lib/auth/session";
import { userHasPermission } from "@/lib/auth/access";
import { validateCsrf } from "@/lib/csrf";

type GuardResult = { session: AuthSession; response?: undefined } | { session?: undefined; response: NextResponse };

/**
 * Shared guard for configuration APIs: signed in, holds the permission (Admin type always does),
 * and, for requests that change data, passes the CSRF check.
 */
export async function requireApiPermission(request: Request, permissionCode: string): Promise<GuardResult> {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }) };

  if (!(await userHasPermission(session, permissionCode))) {
    return { response: NextResponse.json({ message: "Forbidden" }, { status: 403 }) };
  }

  if (request.method !== "GET" && !validateCsrf(request)) {
    return { response: NextResponse.json({ message: "Invalid CSRF token." }, { status: 403 }) };
  }

  return { session };
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function optionalId(value: unknown): string | null {
  const text = str(value);
  return text.length > 0 ? text : null;
}

export function deactivationConfirmationResponse(
  body: Record<string, unknown> | null,
  entity: string,
  usage: Array<{ label: string; count: number }>,
  continuation = "Deactivating stops new use but preserves existing documents and running work.",
): NextResponse | null {
  const activeUsage = usage.filter((item) => item.count > 0);
  if (activeUsage.length === 0 || body?.confirmDeactivate === true) return null;

  const details = activeUsage.map(({ label, count }) => `${count} ${label}`).join(", ");
  return NextResponse.json({
    confirmationRequired: true,
    message: `${entity} is currently in use (${details}). ${continuation} Are you sure you want to continue?`,
  }, { status: 409 });
}

/** Maps common Prisma errors to a readable response; returns null when the error is not a known one. */
export function prismaErrorResponse(error: unknown, messages: { duplicate?: string; reference?: string } = {}): NextResponse | null {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "P2002") {
      return NextResponse.json({ message: messages.duplicate ?? "That already exists." }, { status: 409 });
    }
    if (error.code === "P2003") {
      return NextResponse.json({ message: messages.reference ?? "This record is still in use or points to something that does not exist." }, { status: 409 });
    }
    if (error.code === "P2025") {
      return NextResponse.json({ message: "Record not found." }, { status: 404 });
    }
  }
  return null;
}
