import { USER_TYPE, type UserTypeCode } from "@/lib/auth/roles";

export type UserCapabilitySession = {
  userId: string;
  userType: UserTypeCode;
  email?: string | null;
  name?: string | null;
};

export function isAdminUser(user: { userType: UserTypeCode }): boolean {
  return user.userType === USER_TYPE.ADMIN;
}

export function isClerkUser(user: { userType: UserTypeCode }): boolean {
  return user.userType === USER_TYPE.CLERK;
}

export function isApproverUser(user: { userType: UserTypeCode }): boolean {
  return user.userType === USER_TYPE.ENGINEER || user.userType === USER_TYPE.MANAGER;
}

export function normalizeEmail(email?: string | null): string {
  return (email || "").trim().toLowerCase();
}
