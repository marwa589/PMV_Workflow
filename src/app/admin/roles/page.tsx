// src/app/admin/roles/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import AssignmentsManager from "@/components/admin/assignments-manager";
import RolesManager from "@/components/admin/roles-manager";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminRolesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission("assignments.manage");
  const params = (await searchParams) ?? {};
  const userId = typeof params.userId === "string" ? params.userId : "";

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Roles & Access" subtitle="Roles, their permissions, and who holds them where">
      <AssignmentsManager initialUserId={userId} />
      <RolesManager />
    </DashboardShell>
  );
}
