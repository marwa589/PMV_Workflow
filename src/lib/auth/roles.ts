// The four fixed user types (PDF: user_types.code). A user's type never changes after creation.
// "Roles" in the new system are permission bundles held through UserAssignment, not these.
export const USER_TYPE = {
  CLERK: "clerk",
  ENGINEER: "eng",
  MANAGER: "manager",
  ADMIN: "admin",
} as const;

export type UserTypeCode = (typeof USER_TYPE)[keyof typeof USER_TYPE];

export const USER_TYPE_CODES: UserTypeCode[] = Object.values(USER_TYPE);

// User types that normally act as approvers (used for the /approver area).
export const APPROVER_USER_TYPES: UserTypeCode[] = [USER_TYPE.ENGINEER, USER_TYPE.MANAGER];

export function isUserTypeCode(value: unknown): value is UserTypeCode {
  return typeof value === "string" && (USER_TYPE_CODES as string[]).includes(value);
}

export function getDefaultRouteForRole(userType: UserTypeCode): string {
  switch (userType) {
    case USER_TYPE.CLERK:
      return "/clerk";
    case USER_TYPE.ENGINEER:
    case USER_TYPE.MANAGER:
      return "/approver";
    case USER_TYPE.ADMIN:
      return "/admin";
    default:
      return "/login";
  }
}

export function roleLabel(userType: UserTypeCode): string {
  switch (userType) {
    case USER_TYPE.CLERK:
      return "Clerk";
    case USER_TYPE.ENGINEER:
      return "Engineer";
    case USER_TYPE.MANAGER:
      return "Manager";
    case USER_TYPE.ADMIN:
      return "Admin";
    default:
      return "User";
  }
}
