import "server-only";

import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { getDefaultRouteForRole } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireRole(allowedRoles: UserRole[]) {
  const session = await requireAuth();

  if (!allowedRoles.includes(session.role)) {
    redirect(getDefaultRouteForRole(session.role));
  }

  return session;
}
