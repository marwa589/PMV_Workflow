import { UserLocation, UserRole } from "@prisma/client";

export const USER_LOCATION_ASSIGNMENTS: Record<UserLocation, string[]> = {
  AVR: [
    "dispatcher.pmv@ahmadiah.com",
    "mohammad.mehieddine@ahmadiah.com",
  ],
  AVK: [
    "joemar.paraiso@ahmadiah.com",
    "bernabie.rocha@ahmadiah.com",
    "mohamed.mahran@ahmadiah.com",
    //temp
  "joemar.paraiso@example.com",
  "bernabie.rocha@example.com",
  "mohamed.mahran@example.com",
  ],
  KUWAIT: [
    "omar.merzek@ahmadiah.com",
    "george.azzi@ahmadiah.com",
    "marc.baddour@ahmadiah.com",
    "aqueel.sayed@ahmadiah.com",
    "mohamed.mahmoud@ahmadiah.com",
    "mohamed.shawky@ahmadiah.com",
    "jad.kabalan@ahmadiah.com",
    "aqueel.sayed@example.com",
  "mohamed.shawky@example.com",
  "mohamed.mahmoud@example.com",
  "jad.kabalan@example.com",
  ],
};

export const LOCATION_APPROVER_ASSIGNMENTS: Record<UserLocation, { approver1?: string; approver2: string; approver3: string }> = {
  AVR: {
    approver1: "mohammad.mehieddine@ahmadiah.com",
    approver2: "george.azzi@ahmadiah.com",
    approver3: "marc.baddour@ahmadiah.com",
  },
  AVK: {
    approver1: "joemar.paraiso@ahmadiah.com",
    approver2: "george.azzi@ahmadiah.com",
    approver3: "marc.baddour@ahmadiah.com",
  },
  KUWAIT: {
    approver2: "george.azzi@ahmadiah.com",
    approver3: "marc.baddour@ahmadiah.com",
  },
};

export const USER_LOCATION_BY_EMAIL: Record<string, UserLocation> = Object.fromEntries(
  Object.entries(USER_LOCATION_ASSIGNMENTS).flatMap(([location, emails]) => emails.map((email) => [email.toLowerCase(), location]))
) as Record<string, UserLocation>;

export function normalizeEmail(email?: string | null): string {
  return (email || "").trim().toLowerCase();
}

export function resolveUserLocationFromEmail(email?: string | null): UserLocation | null {
  const normalized = normalizeEmail(email);
  return USER_LOCATION_BY_EMAIL[normalized] ?? null;
}

async function findUserWithEffectiveRole(
  tx: { user: { findFirst: (args: any) => Promise<any | null> } },
  email: string,
  role: UserRole,
) {
  return tx.user.findFirst({
    where: {
      email,
      OR: [{ role }, { roleAssignments: { some: { role } } }],
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      roleAssignments: { select: { role: true } },
    },
  });
}

export async function resolveWorkflowApproverIdsForUploader(
  tx: { user: { findFirst: (args: any) => Promise<any | null> } },
  uploaderEmail?: string | null,
) {
  const location = resolveUserLocationFromEmail(uploaderEmail);
  const assignment = location ? LOCATION_APPROVER_ASSIGNMENTS[location] : null;

  if (!assignment) {
    return { approver1Id: null, approver2Id: null, approver3Id: null, location: null };
  }

  const approver1 = assignment.approver1 ? await findUserWithEffectiveRole(tx, assignment.approver1, UserRole.APPROVER_1) : null;

  const approver2 = await findUserWithEffectiveRole(tx, assignment.approver2, UserRole.APPROVER_2);
  const approver3 = await findUserWithEffectiveRole(tx, assignment.approver3, UserRole.APPROVER_3);

  if (!approver2 || !approver3) {
    throw new Error("Workflow approver accounts are missing for the configured location.");
  }

  return {
    approver1Id: approver1?.id ?? null,
    approver2Id: approver2.id,
    approver3Id: approver3.id,
    location,
  };
}
