// Pure helpers (no database access) so they are safe to use from middleware.
import { APPROVER_USER_TYPES, USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";

export function hasRequiredRole(userType: UserTypeCode, allowed: UserTypeCode[]): boolean {
  return allowed.includes(userType);
}

export function getRoleAccessErrorMessage(allowed: UserTypeCode[]): string {
  return `Access denied. Required user type: ${allowed.join(", ")}`;
}

// Area-level gate only. Whether someone may upload, approve or view a specific document
// is decided per document by the workflow engine and src/lib/auth/access.ts.
export function getRouteAccessPolicy(pathname: string): UserTypeCode[] | null {
  // /admin/* screens are gated page by page with requirePermission (a Flow Admin who is not an Admin
  // user type can open the flow screens), so only the dashboard itself is limited to the Admin type there.
  if (pathname === "/admin") return [USER_TYPE.ADMIN];
  // The review screen serves whoever the flow names, including the uploader when a document is sent back to them,
  // so it is not limited to an area; the page checks eligibility itself.
  if (pathname.startsWith("/approver/review/")) return null;
  if (pathname.startsWith("/approver")) return [...APPROVER_USER_TYPES, USER_TYPE.ADMIN];
  if (pathname.startsWith("/clerk")) return [USER_TYPE.CLERK, USER_TYPE.ADMIN];
  return null;
}
