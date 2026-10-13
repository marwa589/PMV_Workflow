// src/app/admin/flow-assignments/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import FlowAssignmentsManager from "@/components/admin/flow-assignments-manager";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminFlowAssignmentsPage() {
  const session = await requirePermission("flows.manage");

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Flow Assignments" subtitle="Choose which approval flow each kind of document gets">
      <FlowAssignmentsManager />
    </DashboardShell>
  );
}
