import "server-only";

import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { hasRequiredRole } from "@/lib/auth/permissions";

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireRole(allowedRoles: UserRole[]) {
  const session = await requireAuth();

  if (!hasRequiredRole(session.role, allowedRoles)) {
    redirect("/unauthorized");
  }

  return session;
}
