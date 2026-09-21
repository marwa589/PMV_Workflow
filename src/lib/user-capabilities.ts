import { UserRole, type UserLocation } from "@prisma/client";

export type CapabilityRole = UserRole;

export type UserCapabilitySession = {
  userId: string;
  role: UserRole;
  roles?: UserRole[];
  email?: string | null;
  name?: string | null;
  location?: UserLocation | null;
};

export function getUserRoles(user: { role: UserRole; roles?: UserRole[] | null }): UserRole[] {
  return Array.from(new Set([user.role, ...(user.roles ?? [])]));
}

export function hasUserRole(user: { role: UserRole; roles?: UserRole[] | null }, role: UserRole): boolean {
  return getUserRoles(user).includes(role);
}

export function hasAnyUserRole(user: { role: UserRole; roles?: UserRole[] | null }, roles: UserRole[]): boolean {
  return roles.some((candidate) => hasUserRole(user, candidate));
}

export function isClerkRoleUser(user: { role: UserRole; roles?: UserRole[] | null }): boolean {
  return hasAnyUserRole(user, [UserRole.CLERK, UserRole.ADMIN]);
}

export function isApproverUser(user: { role: UserRole; roles?: UserRole[] | null }): boolean {
  return hasAnyUserRole(user, [UserRole.APPROVER_1, UserRole.APPROVER_2, UserRole.APPROVER_3]);
}

export function hasWorkflowPermission(user: { role: UserRole; roles?: UserRole[] | null }, permissionRole: UserRole): boolean {
  return hasUserRole(user, permissionRole);
}
