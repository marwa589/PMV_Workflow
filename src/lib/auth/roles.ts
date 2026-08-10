import { UserRole } from "@prisma/client";

export const APPROVER_ROLES: UserRole[] = [
  UserRole.APPROVER_1,
  UserRole.APPROVER_2,
  UserRole.APPROVER_3,
];

export function getDefaultRouteForRole(role: UserRole): string {
  switch (role) {
    case UserRole.CLERK:
      return "/clerk";
    case UserRole.APPROVER_1:
    case UserRole.APPROVER_2:
    case UserRole.APPROVER_3:
      return "/approver";
    case UserRole.ADMIN:
      return "/admin";
    default:
      return "/login";
  }
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case UserRole.CLERK:
      return "Clerk";
    case UserRole.APPROVER_1:
      return "Approver 1";
    case UserRole.APPROVER_2:
      return "Approver 2";
    case UserRole.APPROVER_3:
      return "Approver 3";
    case UserRole.ADMIN:
      return "Admin";
    default:
      return "User";
  }
}
