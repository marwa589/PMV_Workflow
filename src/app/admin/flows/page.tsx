// src/app/admin/flows/page.tsx
import DashboardShell from "@/components/dashboard-shell";
import FlowsManager from "@/components/admin/flows-manager";
import { requirePermission } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminFlowsPage() {
  const session = await requirePermission("flows.manage");

  return (
    <DashboardShell role={session.userType} userName={session.name} title="Approval Flows" subtitle="Build approval chains with as many levels as needed">
      <FlowsManager />
    </DashboardShell>
  );
}
