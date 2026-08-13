import { UserRole } from "@prisma/client";
import { APPROVER_ROLES } from "@/lib/auth/roles";

export function hasRequiredRole(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(userRole);
}

export function getRoleAccessErrorMessage(allowedRoles: UserRole[]): string {
  return `Access denied. Required role: ${allowedRoles.join(", ")}`;
}

export function getRouteAccessPolicy(pathname: string): UserRole[] | null {
  if (pathname.startsWith("/admin")) {
    return [UserRole.ADMIN];
  }

  if (pathname.startsWith("/approver")) {
    return APPROVER_ROLES;
  }

  if (pathname.startsWith("/clerk")) {
    return [UserRole.CLERK];
  }

  if (pathname.startsWith("/new-document")) {
    return [UserRole.CLERK, UserRole.ADMIN];
  }

  if (pathname.startsWith("/documents") || pathname.startsWith("/procurement-packages")) {
    return [UserRole.CLERK, UserRole.ADMIN, ...APPROVER_ROLES];
  }

  return null;
}
