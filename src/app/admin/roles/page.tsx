// src/app/admin/roles/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import AssignmentsManager from "@/components/admin/assignments-manager";
import RolesAccessTabs from "@/components/admin/roles-access-tabs";
import RolesManager from "@/components/admin/roles-manager";
import { requireUserType } from "@/lib/auth/guards";
import { USER_TYPE } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function AdminRolesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireUserType([USER_TYPE.ADMIN]);
  const params = (await searchParams) ?? {};
  const userId = typeof params.userId === "string" ? params.userId : "";
  // A link to one user's roles always opens the assignments.
  const initialTab = params.tab === "roles" && !userId ? "roles" : "assignments";

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Roles & Access" subtitle="Roles, their permissions, and who holds them where">
      <RolesAccessTabs initialTab={initialTab} assignments={<AssignmentsManager initialUserId={userId} />} roles={<RolesManager />} />
    </DashboardShell>
  );
}
