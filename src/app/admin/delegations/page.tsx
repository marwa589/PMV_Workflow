// src/app/admin/delegations/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import DelegationsManager from "@/components/admin/delegations-manager";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminDelegationsPage() {
  const session = await requirePermission("delegations.manage");

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Delegations" subtitle="Hand approval tasks to another user">
      <DelegationsManager />
    </DashboardShell>
  );
}
