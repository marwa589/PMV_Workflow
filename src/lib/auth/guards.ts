
import "server-only";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { hasRequiredRole } from "@/lib/auth/permissions";
import { userHasPermission, type ScopeContext } from "@/lib/auth/access";
import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";

export async function requireAuth() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

/**
 * Admin is a system-wide superuser and can access every user-type area.
 */
export async function requireUserType(allowed: UserTypeCode[]) {
  const session = await requireAuth();

  if (
    session.userType !== USER_TYPE.ADMIN &&
    !hasRequiredRole(session.userType, allowed)
  ) {
    redirect("/unauthorized");
  }

  return session;
}

/**
 * Admin bypasses permission and scope restrictions.
 * All other users must hold the requested permission.
 */
export async function requirePermission(
  permissionCode: string,
  scope: ScopeContext = {},
) {
  const session = await requireAuth();

  if (
    session.userType !== USER_TYPE.ADMIN &&
    !(await userHasPermission(session, permissionCode, scope))
  ) {
    redirect("/unauthorized");
  }

  return session;
}
