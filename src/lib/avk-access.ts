import { UserRole } from "@prisma/client";

const AVK_MR_VIEWER_EMAILS = new Set([
  "mohamed.mahran@ahmadiah-sa.com",
  "omar.merzek@ahmadiah.com",
  "marc.baddour@ahmadiah.com",
  "ramzi@ahmadiah.com",
  "dispatcher.pmv@ahmadiah.com",
]);

export function isAvkMrViewer(user: {
  email?: string | null;
  location?: string | null;
  role?: UserRole | null;
}): boolean {
  const email = user.email?.trim().toLowerCase();
  return user.location === "AVK"
    || user.role === UserRole.APPROVER_2
    || user.role === UserRole.APPROVER_3
    || Boolean(email && AVK_MR_VIEWER_EMAILS.has(email));
}