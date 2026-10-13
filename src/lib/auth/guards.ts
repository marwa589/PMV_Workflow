import "server-only";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { hasRequiredRole } from "@/lib/auth/permissions";
import { userHasPermission, type ScopeContext } from "@/lib/auth/access";
import type { UserTypeCode } from "@/lib/auth/roles";

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

// Area gate by fixed user type (replaces the old requireRole(UserRole[])).
export async function requireUserType(allowed: UserTypeCode[]) {
  const session = await requireAuth();

  if (!hasRequiredRole(session.userType, allowed)) {
    redirect("/unauthorized");
  }

  return session;
}

// Permission gate through role assignments (e.g. "flows.manage", "documents.view" for one type).
export async function requirePermission(permissionCode: string, scope: ScopeContext = {}) {
  const session = await requireAuth();

  if (!(await userHasPermission(session, permissionCode, scope))) {
    redirect("/unauthorized");
  }

  return session;
}
